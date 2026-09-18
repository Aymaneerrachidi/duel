# Verification record

Verified locally on Windows, 18 September 2026, using Node 22 and the committed pnpm lockfile.

| Check | Result |
|---|---|
| ESLint | Passed |
| TypeScript strict checking | Passed |
| Unit/API/provider/replay/metadata/snapshot and wallet/portfolio tests | 117 passed in the full suite |
| EVM contract scenarios | 14 passed on local Ganache |
| PostgreSQL 17 migrations and integration | Passed in a disposable Docker container |
| Vite production build | Passed |
| Browser tests | 4 passed, including mobile layouts, the complete demo duel lifecycle, and Phantom Solana/EVM linking on desktop and mobile |
| Cloudflare Worker packaging dry run | Passed; about 1.6 MiB compressed |
| Public RPC connectivity | Solana, Robinhood 4663, Base 8453, BNB 56, Ethereum 1 passed |
| Public price endpoints | DEX Screener native references, GeckoTerminal pools and DexPaprika metadata passed |
| Helius/Alchemy/Jupiter/DexPaprika/GMGN credentials | Supplied and tested; Arc mainnet RPC, inventory and transfer index now pass |
| Supabase hosted account / public deployment | Schema installed; public Vercel health/bootstrap/auth protection and authenticated scheduler checked |
| Anchor compile and Solana escrow execution | Not verified: toolchain download exceeded available disk space |
| GitHub hosted checks/scheduler | Jobs did not start: account locked due to billing issue |
| Supabase Cron alternative | Owner installed SQL; consecutive production requests returned 200 at 00:53 and 00:54 UTC on 18 September 2026 |

Production smoke checks at https://duel-rose.vercel.app passed: live bootstrap with six chains, wallet nonce with the correct production domain, rejection of a foreign Origin, authenticated cron success, rejection of missing cron credentials, and protected admin/portfolio routes. A real Chromium session passed desktop/mobile navigation, the EVM wallet dialog, layout checks and zero runtime/server errors. Owner wallet signatures and a complete real-market duel were not exercised.

Playwright runs against its own memory-only demo server on ports 5174/8788, with isolated live-auth memory fixtures for the Phantom tests. It does not use the real `.env`, database or persistent demo file. Its screenshots are written to `.data/qa-home-desktop.png`, `.data/qa-duel-desktop.png` and `.data/qa-home-mobile.png`; traces and HTML reports are local ignored artifacts. Layout checks cover 375, 390, 430 and 768-pixel widths plus desktop.

Phantom regression tests simulate the extension transport, sign with disposable test keys, and send the signatures through the real nonce/verification API. Both desktop and mobile tests sign in with Solana, link Phantom EVM while another EVM extension is installed, reload, and sign back into the same profile with EVM. Tests verify checksummed SIWE addresses, the selected provider, account/network changes, Wallet Standard key/message consistency, session cookies and a single points grant. These are automated provider simulations; the owner's actual Phantom extension still needs a retry after deployment.

PostgreSQL checks exercise full fixture insertion, consistent state reads, optimistic conflict rejection, anonymous access denial, direct historical update/deletion rejection, append-only commits and rate limits. Test cleanup targets only the disposable test container.

Ganache uses its JavaScript fallback on this Windows/Node build because its optional native micro-WebSockets binary is unavailable. Contract scenarios passed with that fallback.

The failed Anchor Docker pull left disk pressure; the machine recovered enough free space to complete the application checks after Docker/WSL restarted. No user volumes or tagged images were removed. Do not retry the large toolchain image until sufficient disk space is available.

These checks establish the working demo and tested components. They do not certify live trading coverage, free-tier production capacity, real-money readiness or a Solana contract deployment. The README and methodology list those remaining limits explicitly.

## Multi-chain update

Added signed wallet linking, cross-network EVM identity reuse, session-bound nonce consumption, concurrent duplicate-ownership prevention, linked-wallet admin access, six-chain challenges and frozen manifests. Added tests for USD-weighted combined returns, missing/duplicate components, tampered totals, unresolved combined cash flows, Arc USDC duplicate prevention, fresh GMGN auth after pacing and isolated Alchemy network failures. The browser lifecycle now creates a combined six-chain demo duel.

The local API reports live mode against Supabase. Arc RPC 5042, Arc USDC aggregate reference pricing and authenticated GMGN Arc market data pass. The deeper finality/indexing audit intentionally reports blockers; see [READINESS.md](READINESS.md). These results do not validate full automatic live settlement.

An additional headless browser smoke check against the actual local live/Supabase server passed: live-mode bootstrap, the EVM wallet dialog without a network selector, all six chains in challenge creation, and layouts at 390/1440px. The production frontend was scanned against configured secrets with no matches.
