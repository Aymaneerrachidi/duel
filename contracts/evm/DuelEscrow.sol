// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Native-asset testnet escrow. Off-chain portfolio results are oracle-authorized.
/// @dev Unaudited. This contract is not enabled by the beta website.
contract DuelEscrow is Ownable, Pausable, ReentrancyGuard {
    enum Status { None, Open, Active, Settled, Cancelled }
    struct Duel {
        address challenger;
        address opponent;
        uint128 stake;
        uint64 expiresAt;
        uint64 duration;
        uint64 endsAt;
        Status status;
        bytes32 resultHash;
    }
    address public immutable settlementAuthority;
    mapping(bytes32 => Duel) public duels;
    mapping(address => uint256) public claimable;
    uint256 public totalLocked;
    uint256 public totalClaimable;

    event DuelCreated(bytes32 indexed id, address indexed challenger, address indexed opponent, uint256 stake, uint64 expiresAt);
    event DuelAccepted(bytes32 indexed id, address indexed opponent);
    event DuelStarted(bytes32 indexed id, uint64 endsAt);
    event DuelSettled(bytes32 indexed id, address indexed winner, bytes32 resultHash);
    event DuelCancelled(bytes32 indexed id);
    event DuelRefunded(bytes32 indexed id);
    event Claimed(address indexed wallet, uint256 amount);

    error InvalidChallenge(); error InvalidState(); error WrongWallet(); error WrongStake();
    error Deadline(); error UnauthorizedOracle(); error EmptyClaim(); error TransferFailed();

    constructor(address administrator, address oracle) Ownable(administrator) {
        if (oracle == address(0)) revert InvalidChallenge();
        settlementAuthority = oracle;
    }
    function createChallenge(bytes32 id, address opponent, uint64 duration, uint64 expiresAt) external payable whenNotPaused nonReentrant {
        if (id == bytes32(0) || duels[id].status != Status.None || opponent == address(0) || opponent == msg.sender) revert InvalidChallenge();
        if (msg.value == 0 || msg.value > type(uint128).max) revert WrongStake();
        if (duration != 1 days && duration != 3 days && duration != 7 days) revert InvalidChallenge();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + 7 days) revert Deadline();
        duels[id] = Duel(msg.sender, opponent, uint128(msg.value), expiresAt, duration, 0, Status.Open, bytes32(0));
        totalLocked += msg.value;
        emit DuelCreated(id, msg.sender, opponent, msg.value, expiresAt);
    }
    function acceptChallenge(bytes32 id) external payable whenNotPaused nonReentrant {
        Duel storage duel = duels[id];
        if (duel.status != Status.Open) revert InvalidState();
        if (msg.sender != duel.opponent) revert WrongWallet();
        if (block.timestamp >= duel.expiresAt) revert Deadline();
        if (msg.value != duel.stake) revert WrongStake();
        duel.endsAt = uint64(block.timestamp + duel.duration);
        duel.status = Status.Active;
        totalLocked += msg.value;
        emit DuelAccepted(id, msg.sender);
        emit DuelStarted(id, duel.endsAt);
    }
    function cancelExpiredChallenge(bytes32 id) external nonReentrant {
        Duel storage duel = duels[id];
        if (duel.status != Status.Open) revert InvalidState();
        if (msg.sender != duel.challenger) revert WrongWallet();
        if (block.timestamp < duel.expiresAt) revert Deadline();
        duel.status = Status.Cancelled;
        totalLocked -= duel.stake;
        _credit(duel.challenger, duel.stake);
        emit DuelCancelled(id);
    }
    /// @param outcome 0=tie, 1=challenger, 2=opponent.
    function settleDuel(bytes32 id, uint8 outcome, bytes32 resultHash) external whenNotPaused nonReentrant {
        if (msg.sender != settlementAuthority) revert UnauthorizedOracle();
        Duel storage duel = duels[id];
        if (duel.status != Status.Active || outcome > 2 || resultHash == bytes32(0)) revert InvalidState();
        if (block.timestamp < duel.endsAt) revert Deadline();
        duel.status = Status.Settled;
        duel.resultHash = resultHash;
        uint256 pot = uint256(duel.stake) * 2;
        totalLocked -= pot;
        address winner;
        if (outcome == 0) { _credit(duel.challenger, duel.stake); _credit(duel.opponent, duel.stake); }
        else { winner = outcome == 1 ? duel.challenger : duel.opponent; _credit(winner, pot); }
        emit DuelSettled(id, winner, resultHash);
    }
    /// @notice Recover funds if the settlement oracle cannot produce a result within seven days.
    function refundDuel(bytes32 id) external nonReentrant {
        Duel storage duel = duels[id];
        if (duel.status != Status.Active) revert InvalidState();
        if (msg.sender != duel.challenger && msg.sender != duel.opponent) revert WrongWallet();
        if (block.timestamp < duel.endsAt + 7 days) revert Deadline();
        duel.status = Status.Cancelled;
        totalLocked -= uint256(duel.stake) * 2;
        _credit(duel.challenger, duel.stake); _credit(duel.opponent, duel.stake);
        emit DuelRefunded(id);
    }
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert EmptyClaim();
        claimable[msg.sender] = 0; totalClaimable -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Claimed(msg.sender, amount);
    }
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    function _credit(address wallet, uint256 amount) private {
        claimable[wallet] += amount; totalClaimable += amount;
    }
}
