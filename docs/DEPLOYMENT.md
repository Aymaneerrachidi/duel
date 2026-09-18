# Deployment and capacity

## Vercel + Supabase

Production: **https://duel-rose.vercel.app**. GitHub is linked for deployments. Keep `NODEJS_HELPERS=0` so Vercel does not consume request bodies before Hono; the adapter also disables body parsing explicitly.

**The Supabase scheduler is active.** Consecutive production requests returned HTTP 200 at 00:53 and 00:54 UTC on 18 September 2026. It checks each minute while the app retains five-minute wallet refresh limits, independently of the previously reported GitHub Actions billing lock.

For a new installation, run `pnpm scheduler:prepare` and paste `.data/enable-supabase-scheduler.sql` into Supabase SQL Editor as postgres. The private SQL inserts/updates its token in Vault and registers only the `pnl-duels-refresh` job. See [Supabase scheduling and Vault](https://supabase.com/docs/guides/functions/schedule-functions). Confirm `/admin` shows advancing refresh times. If needed, enable Cron under Supabase Integrations first. The current installation does not need to be repeated.

The root `vercel.json` builds React and a Node 22 Hono function. Static assets come from `dist`; `/api`, `/og` and social challenge pages use the function. Secrets are server variables, never `VITE_*` variables.

1. Apply `supabase/setup.sql` once. The current database already has this schema.
2. Run `vercel link` and choose the intended project/team.
3. Set production variables from `.env.example`, including `DEMO_MODE=false`, Supabase server credentials, random `SESSION_SECRET`, public `ADMIN_WALLETS`, provider keys and a separate random `CRON_SECRET` of at least 32 characters. Use stdin prompts or the dashboard, never secret command arguments or Git.
4. Set `APP_ORIGIN` to the exact production HTTPS origin used for sign-in.
5. Run the build/tests, then `vercel --prod`. Check health/bootstrap, auth nonce, protected endpoints and browser navigation.
6. Set GitHub repository variable `APP_ORIGIN` and secret `CRON_SECRET` to matching values. Enable Actions. The scheduler workflow calls `/api/cron` every five minutes and supports manual dispatch. Missing/incorrect bearer tokens return 401.

GitHub schedules can be delayed; inactive public-repository schedules can be disabled. This is a free beta refresh mechanism, not a hard timing guarantee. Vercel Hobby daily cron cannot supply five-minute updates. Missed ending evidence causes a dispute. The included Cloudflare adapter offers its own free cron as an alternative; the shared database lease prevents overlapping jobs.

Failed runtime initialization resets for recovery after temporary database outages. API responses are no-store; completed public share images are immutable-cacheable. The function packages WASM/font resources for PNG rendering.


## Cloudflare + Supabase

Use a new Supabase project and apply all three SQL migrations. Use separate databases for live and demo deployments.

1. Run `pnpm install`, `pnpm build`, `pnpm worker:check`.
2. Run `pnpm exec wrangler login` using your Cloudflare account.
3. Choose the Worker name in `wrangler.toml` and set `APP_ORIGIN` to its final HTTPS origin. Use the exact same origin when visiting and authenticating.
4. Set server secrets interactively:

```powershell
pnpm exec wrangler secret put SUPABASE_URL
pnpm exec wrangler secret put SUPABASE_SERVICE_ROLE_KEY
pnpm exec wrangler secret put SESSION_SECRET
pnpm exec wrangler secret put HELIUS_API_KEY
pnpm exec wrangler secret put ALCHEMY_API_KEY
```

Optional keys use the same command. Add `APP_ORIGIN` and `ADMIN_WALLETS` as secrets or nonsecret vars. Never put secrets directly in the TOML file. Use lowercase EVM addresses in `ADMIN_WALLETS`; preserve Solana casing.

5. Leave demo mode on for an initial deployment with a separate demo database. To use live data set `DEMO_MODE = "false"` and use a separate new database. Keep all real-money/paid-usage flags false.
6. Run `pnpm deploy:cloudflare`. Visit `/api/health`, sign in, verify admin access, then inspect the first scheduled tick.

The dry-run bundle has been checked locally. A dry run does not prove account quotas, network connectivity, production CPU time or deployed credentials. Browser E2E tests use the local Node adapter, not Cloudflare's production runtime.

## Important free-tier limits

Workers Free has request and CPU limits; Supabase Free has database and egress limits. Check the official [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/) and [Supabase pricing](https://supabase.com/pricing) for your deployment. PNG rendering through resvg and full-state JSON processing can exceed the free Worker CPU budget for large records/cold renders. Measure before inviting users. Pre-render/store completed image artifacts if needed; an R2 integration is not implemented in this beta.

The current scheduler runs every five minutes in Cloudflare and processes at most **two live duels per invocation**. Larger sets rotate, with earliest ending duels first. Ten simultaneous duels therefore do not all refresh every five minutes. The `MAX_ACTIVE_DUELS=10` limit includes open challenges; it is a safety cap, not a demonstrated service capacity. Begin live testing with one or two small wallets. Local development checks the scheduler every 15 seconds, but normal snapshot updates are due every five minutes.

At two Solana duels, four small wallets, a five-minute interval and six baseline RPC calls/wallet, the baseline is roughly `4 * 288 * 30 * 6 = 207,360` RPC calls/month. Signature indexing, transaction reads, same-slot ordering and fallbacks are extra. A busy wallet with many token accounts costs much more. At ten duels that same baseline alone exceeds one million requests/month, before transaction indexing. This is why the build does not promise 50 active duels inside a free Helius account.

## Before scaling

- Replace whole-state reads with bounded repository queries and dedicated transactional SQL commands. Isolate quota counters/leases from full portfolio data.
- Cache public read models at the edge, page duel/snapshot history, and maintain materialized leaderboard aggregates. Current browser polling is 30 seconds and server read caching is five seconds.
- Index a wallet once even if it participates in several duels. Batch due wallets and shared token prices; bound per-job work by actual quota and pending settlement deadlines.
- Store compact evidence and archived completed histories with an explicit retention policy. Never prune live evidence or rewrite a completed result to save space.
- Implement complete supported-chain/DEX decoders and historical evidence backfill. Data loss near a deadline must remain a dispute, not a guessed close.
- Load-test concurrent viewers and acceptance races against real Supabase/Worker deployment; monitor p95 latency, DB/egress growth, provider 429s, stale prices, missed boundaries and disputes.

## Operations

`/admin` shows observed app usage, configured-key presence, provider errors/cooldowns, last scheduler tick, disputes and the audit log. A configured key is not evidence of connectivity. Use `pnpm providers:check` and the external account dashboards as well. Pause new challenges when providers are unstable; retain settlement capacity.

Back up the local `.data` directory when the API is stopped, or export your Supabase database using its supported tools. Restoring a backup does not retroactively recover missing chain/price evidence. Rotate API keys on the server and restart/redeploy; changing `SESSION_SECRET` invalidates sessions. The app contains no automatic billing upgrades or server wallet.
