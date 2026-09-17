# Escrow contracts — separate from the web beta

No contract is deployed or used to accept funds by the application. No private settlement key is required to run it. The web's stake field is a simulated competition term.

## EVM

`contracts/evm/DuelEscrow.sol` uses OpenZeppelin ownership, pause controls and reentrancy protection. Two distinct wallets deposit equal native stakes. Durations are 1, 3 or 7 days. Expired open challenges refund the challenger. An immutable settlement authority can publish a result only after the duel ends; a zero/duplicate/unauthorized result is rejected. Outcomes are a challenger win, opponent win or tie. Withdrawals are pull payments. After the end plus seven days, a participant can refund an unresolved duel even if the contract is paused.

The escrow trusts the settlement authority's result; it does not calculate PnL on-chain. The result hash links to off-chain calculation evidence. There are no protocol fees or upgrade hooks in this implementation.

```powershell
pnpm test:contracts
```

This compiles Solidity with the pinned package lock and runs against an in-process Ganache EVM. It checks authorization, equal deposits, expiry, early/duplicate actions, winning/tie settlement, timeout refunds, withdrawal accounting, reentrant recipients and a stake/outcome conservation sweep. The ABI/build artifact is in `contracts/evm/artifacts/DuelEscrow.json`. Local tests are not an independent audit.

Before any testnet deployment review the owner/authority addresses, native currency and chain ID, verify source, and test with valueless test currency. Mainnet wiring, signed settlement delivery, monitoring, frontend deposit/claim flows and external review are outstanding; adding `EVM_ESCROW_ADDRESS` alone does not implement them.

## Solana

`contracts/solana/programs/duel_escrow/src/lib.rs` implements native SOL escrow using a configuration PDA and a unique duel PDA. Configuration initialization is restricted to the program's upgrade authority. Duels bind challenger, opponent, amount, deadline, duration, settlement authority and result hash. Account constraints enforce signer/recipient/PDA ownership. Rent stays in the duel account; preserving its identity prevents ID reuse. Expired-open and delayed-unresolved refunds are included.

Pinned toolchain: Anchor 0.32.1 and Solana/Agave 2.3.0, following the [Anchor 0.32.1 notes](https://www.anchor-lang.com/docs/updates/release-notes/0-32-1). Use Linux/macOS or a sufficiently provisioned Linux development environment. Do not run the smoke tests against mainnet or a public testnet.

```sh
cd contracts/solana
solana-keygen new --no-bip39-passphrase
solana config set --url localhost
anchor keys sync
anchor build
anchor test
```

`anchor keys sync` must align `declare_id!`, the Anchor configuration and the generated program keypair before deployment. Generated secrets stay outside version control. The repository-level equivalent of the final command is `pnpm test:solana`.

The included TypeScript smoke test uses the generated IDL and local validator to exercise initialization, deposits, signer/amount/state checks, pause, early settlement/refund rejection and expired challenge refunds.

**Verification status:** the Anchor build and this smoke test have not run successfully in this workspace because the toolchain download exhausted available disk space. There is no claimed compiled Solana artifact. Successful settlement/tie/timeout time-warp tests, arithmetic/rent invariants and independent review are still required. Do not deploy this source with funds based on the EVM test results.
