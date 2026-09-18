# Beta readiness — 18 September 2026

This is a live-wallet **paper-duel beta**. Wallet linking, six-chain accounting, supported transaction replay, predictions, sharing and the demo lifecycle are implemented. Stakes remain simulated; the app never broadcasts trades or custody transactions.

## Configured

- Supabase schema installed; state reads work and the publishable key cannot access private app state.
- Live mode enabled. Session and scheduler secrets generated. Credentials stored in ignored local environment files and Vercel server environment variables.
- Both owner public wallets configured for admin access. Either linked wallet can sign into the same account.
- Helius, Jupiter, DexPaprika and authenticated GMGN verified. Alchemy RPC/token inventory works for Ethereum, Base, BNB and Robinhood.
- Arc Mainnet (5042) enabled in application configuration; public primary and independent RPC backup configured. Native USDC and its ERC-20 interface are counted once.
- Vercel adapter, security headers, SPA routes, dynamic social metadata and authenticated scheduled refresh implemented.

## Setup confirmed

Both previously outstanding setup items were verified on 18 September 2026:

- **Arc:** the configured Alchemy key now returns mainnet chain ID 5042, ERC-20 token inventory, a finalized block and transfer history successfully.
- **Scheduled refresh:** after the owner installed the Supabase scheduler SQL, Vercel recorded successful `GET /api/cron` requests at **00:53:00 and 00:54:00 UTC**, one minute apart. No manual scheduler request was made during this verification. Production health also returned HTTP 200 in live mode.

The Supabase job provides the recurring trigger independently of GitHub Actions. GitHub previously refused to start hosted jobs because of an account billing lock; that check did not test application code. Wallet refreshes still use the configured five-minute interval, quota budgets and shared job lease.

The public scheduler template is [scheduler.sql](../supabase/scheduler.sql). For another installation, `pnpm scheduler:prepare` creates a private filled copy under `.data/`; it contains a token and must remain outside Git. The current installation does not need to be repeated.

This confirms provider access and recurring scheduling for the paper beta. It does not extend supported protocol coverage or enable real-money stakes.

## Supported settlement scope

| Area | Behavior |
| --- | --- |
| Two linked wallets | Signed Solana/EVM linking; no chain switching for tracking |
| Combined equity | Sum eligible USD; freeze wallets/networks at acceptance |
| EVM replay | Logs, nonce coverage, receipts, execution/L1/blob fees, exact ending quantities |
| EVM trades | Direct Uniswap v2 (Ethereum) and PancakeSwap v2 (Ethereum, Base, BNB, Robinhood) swaps with owned recipients; plain transfers and approvals |
| Solana trades | Plain native/SPL transfers, failed-transaction fees, selected Jupiter routes between existing owned SPL accounts |
| Cash flows | Chronological whole-portfolio pre/post valuations; fees reduce performance |
| Finality | Canonical finalized hashes required before publishing results |
| Temporary outage | Retain last complete snapshot and retry reconciliation |
| Unknown protocol/data gap | Incomplete/disputed; no inferred winner |

Bridges, smart/delegated EVM wallets, arbitrary router commands, Solana wrapping/account creation/closure, Token-2022 extensions and unsupported DeFi instructions need additional decoders. Free historical prices/internal-transfer coverage can be unavailable. Not every possible trade on every chain settles automatically.

Mainnet wagers and trading execution are not enabled. EVM contract tests passed; separate Solana escrow source has not been compiled/execution-tested locally because its toolchain exceeded available disk space. Neither contract is independently audited.

## Verify and operate

Run `pnpm providers:check`, `pnpm readiness:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e`. Reports omit credentials and are saved under ignored `.data/`.

Use `/admin` after signing with an owner wallet to check quotas, scheduled refresh, disputes and the pause switch. Start with one or two small-wallet paper duels. The free GitHub scheduler can be delayed; missed ending evidence is disputed rather than guessed. See [deployment](DEPLOYMENT.md), [methodology](PNL.md), and the [API walkthrough](API_SETUP.md).
