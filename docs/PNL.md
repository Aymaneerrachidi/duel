# Portfolio return methodology — twr-v1

## Measure

New live duels use `twr-portfolio-v1`: sum eligible USD equity across Solana, Base, BNB, Ethereum, Robinhood and Arc for the trader's two verified wallets. Networks are recorded at creation and wallets freeze at acceptance. Legacy single-chain records retain `twr-v1`. Exchange accounts, leverage, NFTs and lending claims are not valued.

The combined score is based on total equity, never the mean of chain percentages. A $100 Solana position doubling while $900 on Base is unchanged produces +10%, not +50%. Every included chain must have complete evidence. Component records, wallet manifest and chain scope are part of the final result hash.

Combined flows use chronological replay across included chains and point-in-time whole-portfolio valuations. A chain-only denominator is never substituted. Unknown bridges/protocols, ambiguous ordering, missing prices and unsynchronized boundaries remain pending. See [READINESS.md](READINESS.md).

For each external transfer, value the whole wallet immediately before and after that transfer using point-in-time prices. Network fees are deducted from the pre-flow balance. If V0 is the starting equity, Bi/Ai are the before/after values for each flow, and Ve is the ending equity:

`TWR = ((B1 / V0) * (B2 / A1) * ... * (Ve / An) - 1) * 100`

Without external flows it reduces to `(Ve / V0 - 1) * 100`. Deposits and withdrawals do not count as profit. Example: 100 -> 110, deposit 100 -> 210, then 231 gives `(110/100)*(231/210)-1 = 21%`. A simple end/start calculation would incorrectly show 131%.

Amounts use decimal arithmetic with 40 significant digits. Every flow must satisfy `after - before = flow` within 0.000001 USD. Zero starting equity, unresolved flows and a completely withdrawn portfolio cannot generate a verified return. Trading/network fees count against performance; verified swaps are internal portfolio changes.

## Valuation evidence

Assets are keyed by chain and address. Native currency uses the distinct accounting key `native`; wrapped native tokens remain separate. Arc USDC is an exception: its native balance and 6-decimal ERC-20 interface refer to the same asset and are counted once. Accounts holding the same token are aggregated before valuation. Each position stores raw and decimal balances, reference price, source, pool, liquidity, observation time, source time, exclusions and haircut.

Rules in `packages/core/src/config.ts`:

| Rule | Value |
|---|---|
| Minimum eligible starting equity | $10 |
| Dust | Below $1 |
| Minimum pool liquidity | $10,000 |
| Minimum pool age when provided | 1 hour |
| Maximum price age | 120 seconds; future prices rejected |
| Cross-pool divergence limit | 20% |
| Position / pool-liquidity ratio <= 2% | Full reference value |
| Ratio > 2%, <= 10% | 90% of reference value |
| Ratio > 10%, <= 25% | 50% of reference value |
| Ratio > 25% | Excluded |
| Tie tolerance | 0.05 percentage points |
| Allowed snapshot boundary difference | 300 seconds |

DEX Screener is primary; GeckoTerminal supplies independent pool evidence. Jupiter is a cross-check. DexPaprika's aggregate fallback is useful for display but explicitly makes the snapshot incomplete for settlement. Pool age is not supplied by every provider; unknown age is a remaining eligibility limitation. Quoted liquidity is not a proof that a token can be sold and does not detect every honeypot, transfer tax, wash trade or malicious token behavior.

A missing nonzero-asset price or stale/conflicting quote prevents verified scoring. A starting asset that was excluded but later becomes eligible requires baseline reconciliation rather than generating free performance from an eligibility change.

## Solana indexing

Token discovery covers classic SPL and Token-2022 accounts. Final balances for the discovered accounts and native wallet are re-read together at one finalized slot. Snapshot accounting time is the block timestamp, not the HTTP response time. A price observed after that block is rejected; acceptance can warm observations and retry before recording its starting boundary. Activity overlapping discovery, unsupported extensions, unsafe numeric precision and excessive wallet size are reported explicitly.

Indexing requests signatures only after the previous recorded slot for the wallet and both previous/current token accounts. Pagination is bounded at 1,000 signatures/address. Transactions in the same slot are ordered using the finalized block signature order. Token deltas are aggregated across accounts of the same mint, including emptied accounts. Raw ending balances must exactly reconcile.

Supported classification: plain native/SPL transfer, failed transaction fee, Jupiter `route`, `exact_out_route`, `shared_accounts_route`, `shared_accounts_exact_out_route` between existing wallet-owned SPL accounts. Jupiter validation checks the program, instruction discriminator, authority signature, input/output ownership, token deltas and native fee-only change. An unknown instruction or an extra unexplained transfer is rejected.

Jupiter's [official IDL](https://github.com/jup-ag/instruction-parser/blob/main/src/idl/jupiter.ts) supplies the supported account layouts. This limited decoder does not cover native wrapping/unwrapping, associated-account creation, token ledgers, Jupiter Ultra, all aggregators or every memecoin trading route.

## Historical transfers

Use a prior stored quote within 120 seconds of the transaction. If absent, request a DefiLlama historical quote, requiring confidence >= 0.9, a source timestamp no later than the transaction, and a prior recorded liquidity observation within ten minutes. Today's quote is never substituted for a missing historical transfer price. A newly received token can lack the necessary historical evidence and therefore pause finalization.

## EVM coverage

Balances use recent block numbers/hashes, ERC-20 discovery and pinned balanceOf/decimals calls. Logs discover token movements; nonce bisection also finds outgoing approvals and failed transactions omitted by transfer indexes. Receipts establish exact deltas, gas/data/blob fees and ordering. Supported internal transfers use exact indexed raw values. Replay must reconcile to ending quantities; unexplained incoming value cannot become profit.

Known direct Uniswap v2/PancakeSwap v2 calls are decoded, output recipients must be owned, and input/output deltas must match. Unknown contracts, delegated/smart wallets, ambiguous native movements and bridges remain incomplete. Paid Debug/Trace APIs are not called.

Recent EVM evidence is provisional. Canonical finalized hashes must match recorded snapshots and relevant transactions before settlement. Pending finality retries for up to two hours without taking a later ending portfolio. Reorganizations stop finalization. Proofs enter the result hash. Unavailable intermediate reads retry from the last complete snapshot; ending evidence must remain inside the fixed five-minute boundary tolerance.

Arc native USDC uses an observed canonical USDC reference from a liquid Ethereum pool, annotated with its reference chain/address. It is not fixed to $1. The 18-decimal native balance and 6-decimal ERC-20 interface are the same funds and are never added together.

See [readiness](READINESS.md) for supported operations and external requirements.
