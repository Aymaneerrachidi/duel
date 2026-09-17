# Beta readiness — 18 September 2026

This is a live-wallet **paper-duel beta**. Wallet linking, six-chain accounting, supported transaction replay, predictions, sharing and the demo lifecycle are implemented. Stakes remain simulated; the app never broadcasts trades or custody transactions.

## Configured

- Supabase schema installed; state reads work and the publishable key cannot access private app state.
- Live mode enabled. Session and scheduler secrets generated. Credentials stored in ignored local environment files and Vercel server environment variables.
- Both owner public wallets configured for admin access. Either linked wallet can sign into the same account.
- Helius, Jupiter, DexPaprika and authenticated GMGN verified. Alchemy RPC/token inventory works for Ethereum, Base, BNB and Robinhood.
- Arc Mainnet (5042) enabled in application configuration; public primary and independent RPC backup configured. Native USDC and its ERC-20 interface are counted once.
- Vercel adapter, security headers, SPA routes, dynamic social metadata and authenticated scheduled refresh implemented.

## Remaining external setup

The saved Alchemy key still receives **“ARC_MAINNET is not enabled for this app”**. Enable **Arc Mainnet** for the same app/key, rather than Arc Testnet or a different app. Check [Alchemy Networks](https://dashboard.alchemy.com/apps/t2fo38w7pkh4tlq4/networks), then run `pnpm readiness:check`.

Public Arc RPC reads known balances but cannot replace the token-discovery index. A six-chain challenge cannot accept an incomplete Arc component. More unrelated API keys will not resolve this entitlement.

**Scheduled refresh is not active yet.** GitHub blocked both Actions jobs before starting: “your account is locked due to a billing issue.” The authenticated Vercel scheduler endpoint was tested successfully, but GitHub cannot invoke it on schedule while the account is locked. Cloudflare is not signed in locally.

A Supabase alternative is prepared in the private local file `.data/enable-supabase-scheduler.sql`. Run its contents in this project's Supabase SQL Editor once. It stores the existing scheduler token in Vault and checks for due work every minute. No new API key is required. The filled file contains a secret and is excluded from Git. The public template is [scheduler.sql](../supabase/scheduler.sql); regenerate the private copy with `pnpm scheduler:prepare`. This SQL has not been executed against the hosted database by this build.

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
