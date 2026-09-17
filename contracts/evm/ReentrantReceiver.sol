// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IEscrow {
    function createChallenge(bytes32,address,uint64,uint64) external payable;
    function cancelExpiredChallenge(bytes32) external;
    function claim() external;
}
contract ReentrantReceiver {
    IEscrow public immutable escrow;
    uint256 public attempted;
    constructor(address e) { escrow = IEscrow(e); }
    function create(bytes32 id,address opponent,uint64 expiry) external payable { escrow.createChallenge{value:msg.value}(id,opponent,1 days,expiry); }
    function cancel(bytes32 id) external { escrow.cancelExpiredChallenge(id); }
    function withdraw() external { escrow.claim(); }
    receive() external payable { attempted++; try escrow.claim() {} catch {} }
}
