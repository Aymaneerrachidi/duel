# Where to get the APIs

Checked 17 September 2026. I inspected the existing `Desktop/Memecoins core/source-audit` research, including its endpoint audit, pricing notes and GMGN findings, then checked current official sources and ran live read-only probes. Free entitlements can change; your account dashboard is authoritative.

The supplied keys, session secret and live flags are already saved in this workspace. **Do not overwrite your populated `.env` with the example.** Current verification and remaining tasks are in [READINESS.md](READINESS.md).

## 1. Make your local configuration

Keep the running demo as it is until you have keys. In a new terminal at the project root:

```powershell
if (-not (Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
```

Edit `.env` in your editor. All listed keys are server-side. Do not use a `VITE_` prefix, paste private keys into the website, or commit this file.

**First get Helius. Then Alchemy. Supabase is needed when deploying, but local persistence works without it.** Jupiter, DexPaprika and GMGN are optional.

## 2. Helius — primary Solana RPC

1. Open [Helius](https://www.helius.dev/), sign up and open the dashboard.
2. Create a project on the **Free** plan for Solana mainnet.
3. Open the project's API keys / RPC endpoints and copy the API key.
4. Paste only the key into `HELIUS_API_KEY=`. Alternatively, put the complete RPC URL in `SOLANA_RPC_URL=`.

```dotenv
HELIUS_API_KEY=your_key_here
```

The advertised free allowance is **1,000,000 credits/month and 10 requests/second**. Standard RPC usually costs 1 credit, DAS 10, and enhanced transaction endpoints 100. This implementation uses standard RPC and caps its own Helius estimate at 900,000 credits. It does not call expensive enhanced history endpoints. [Pricing](https://www.helius.dev/pricing), [credit costs](https://www.helius.dev/docs/billing/credits).

Built-in backups: your optional `SOLANA_BACKUP_RPC_URL`, an Alchemy Solana endpoint if its key supports that network, Solana's public mainnet RPC, then PublicNode. Public endpoints have no availability guarantee; backup failure is shown as incomplete data.

## 3. Alchemy — EVM RPC and token discovery

1. Open [Alchemy](https://dashboard.alchemy.com/) and create a Free account/app.
2. Enable Ethereum, Base, BNB, Robinhood and Arc mainnet on the app where offered. Optionally enable Solana for backup reads.
3. Copy the app API key into `ALCHEMY_API_KEY=`.
4. If your dashboard issues different app URLs per chain, put the full URLs into `BASE_RPC_URL`, `BNB_RPC_URL`, `ETHEREUM_RPC_URL`, `ARC_RPC_URL`, `ROBINHOOD_RPC_URL` or `SOLANA_BACKUP_RPC_URL` as appropriate.

```dotenv
ALCHEMY_API_KEY=your_key_here
```

Alchemy's Free plan advertises **30 million compute units/month and 300 CU/second**. These are **compute units, not 30 million requests**. The app tracks conservative method-cost estimates against 27 million CU; check actual dashboard usage because prices differ by method. [Free-tier details](https://www.alchemy.com/support/free-tier-details).

Public chain RPCs are included as fallbacks and their chain IDs are checked. Public RPC does not replace Alchemy's token discovery or Transfers API. Network/API availability on your account must be tested. EVM transaction classification is still limited as described in the README.

## 4. Supabase — optional locally, required for this Cloudflare deployment

1. Create a **new Free project** at [Supabase](https://supabase.com/dashboard).
2. In SQL Editor run these files, in order:
   - `supabase/migrations/001_schema.sql`
   - `supabase/migrations/002_atomic_functions.sql`
   - `supabase/migrations/003_evidence_guards.sql`
3. Copy the project URL from the Connect dialog / project API settings into `SUPABASE_URL`.
4. Copy a server `sb_secret_...` key or legacy `service_role` key from API keys into `SUPABASE_SERVICE_ROLE_KEY`. A publishable/anon key cannot access these tables.

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_server_service_role_key
```

`SUPABASE_ANON_KEY` is not used by this server-only data model. Never put the service-role key in frontend code. Use **separate projects for demo and live mode**; the server rejects mixed profile data. Free database/storage/egress caps and project pausing apply. [Supabase pricing](https://supabase.com/pricing).

## 5. Jupiter — optional Solana price cross-check

1. Open [Jupiter Portal](https://portal.jup.ag/).
2. Create a **Free API key**.
3. Paste it into `JUPITER_API_KEY=`.

The current portal documents a keyless limit of **0.5 requests/second** and a Free-key limit of **1 request/second**. The app uses `api.jup.ag/price/v3`, with an `x-api-key` header if configured. Jupiter checks a price against independently sourced pool evidence; it does not invent missing liquidity. [Portal setup](https://developers.jup.ag/docs/portal/setup), [plans](https://developers.jup.ag/docs/portal/plans).

## 6. DexPaprika — optional extra fallback

Start at [DexPaprika](https://dexpaprika.com/) and its [API documentation](https://docs.dexpaprika.com/). Request/create a Free key through the current account/API access flow and set `DEXPAPRIKA_API_KEY=`. It also works without a key.

Published limits: **50,000 keyless calls per IP per rolling 30 days, 15/minute**; a Free key offers **300,000 per rolling 30 days, 50/minute**. Free responses can lag by up to 60 seconds. The app stays below the smaller keyless allowance by default, keeps a conservative rolling-window counter, and does not use a paid endpoint. Aggregated token liquidity is shown as a fallback but cannot prove individual-pool liquidity for settlement. [Rate limits](https://docs.dexpaprika.com/knowledge-base/rate-limits).

## 7. GMGN — optional market context

1. Start at [GMGN AI/API](https://gmgn.ai/ai) and read the official [GMGN Skills repository](https://github.com/GMGNAI/gmgn-skills).
2. Follow the current API access/application flow to obtain **your own key**. If the application asks for an Ed25519 public key, run:

```powershell
pnpm gmgn:keygen
```

3. Submit the generated `.data/gmgn/public.pem` when requested. Keep `.data/gmgn/private.pem` local. The read-only adapter needs the API key, not the signing private key.
4. Verify with GMGN that your key has a **free read entitlement** before enabling it:

```dotenv
GMGN_API_KEY=your_own_key
GMGN_FREE_ACCESS_CONFIRMED=true
```

The adapter calls the official `openapi.gmgn.ai/v1/market/rank` endpoint with `X-APIKEY`, a Unix-seconds `timestamp` and a fresh UUID `client_id`. Authentication values are generated after quota pacing; results are cached for five minutes. Its results are available through authenticated `/api/market/solana`, `/api/market/base`, `/api/market/bnb`, `/api/market/ethereum`, `/api/market/robinhood` and `/api/market/arc`. Solana and Arc were tested with the supplied key.

There is no universal free GMGN quota verified for arbitrary private keys. Access can depend on approval. The conservative 1,000-request app budget is **our limit, not a promise from GMGN**. The public key seen in GMGN's docs is for testing and is not wired into the app. There is no frontend scraping or anti-bot bypass. GMGN discovery data never decides a duel winner.

## Already working without keys

| Provider | Use | Behavior |
|---|---|---|
| [DEX Screener](https://docs.dexscreener.com/api/reference) | Main token price and pool-liquidity source | Batches up to 30 addresses, caches 45 seconds; token endpoints advertise 300 requests/minute |
| [GeckoTerminal](https://apiguide.geckoterminal.com/faq) | Independent pool-price fallback | Public API, conservative app pacing below its published 30 requests/minute |
| DexPaprika | Additional aggregate price fallback | Keyless, rolling-window budget; aggregate evidence cannot auto-finalize |
| [DefiLlama](https://api-docs.defillama.com/) | Historical price lookup | Used only when a prior recorded liquidity observation also exists; missing history blocks reconciliation |
| Solana / PublicNode / public EVM RPCs | Read-only RPC fallback | Rate-limited, chain checked; never broadcasts funds |
| [Robinhood Chain](https://docs.robinhood.com/chain/) | Public mainnet RPC | Verified chain ID 4663; testnet 46630 is a different network |

## Arc mainnet

Arc is included automatically in the combined EVM portfolio. Its mainnet chain ID is **5042**; native gas is **USDC with 18 decimals**. The primary RPC is `https://rpc.mainnet.arc.io` and its independent backup is `https://rpc.drpc.mainnet.arc.io`. An optional custom URL goes in `ARC_RPC_URL`. [Official network settings](https://docs.arc.io/arc/references/connect-to-arc).

The ERC-20 USDC interface at `0x3600000000000000000000000000000000000000` uses 6 decimals and represents the same native balance; the app counts it once. [Official contract reference](https://docs.arc.io/arc/references/contract-addresses). Public RPC does not by itself establish complete ERC-20 discovery, historical flows or trustworthy pool prices.

## Turn on live wallet reads

Generate a random session secret locally:

```powershell
node -p "require('node:crypto').randomBytes(32).toString('hex')"
```

Put the result in `SESSION_SECRET`. This command generates an application session secret, not a wallet key. Then:

```dotenv
DEMO_MODE=false
APP_ORIGIN=http://127.0.0.1:5173
SESSION_SECRET=paste_generated_value
REAL_MONEY_ENABLED=false
REAL_MONEY_SPECTATOR_MARKETS=false
ALLOW_PAID_PROVIDER_USAGE=false
ESCROW_MODE=simulated
```

Restart `pnpm dev`, run `pnpm providers:check`, connect your first wallet, then use **Link wallets** to sign with the second wallet. One EVM address covers every supported EVM chain, without switching networks for tracking. Open your profile's **Your portfolios** tab. Sign-in asks for a message signature, never a transfer. Inspect any valuation/coverage warnings before trying a paper duel. Test output is saved to `.data/provider-check.json` without keys.

If a provider returns 401/403, check the key and network permissions. For 429, wait for the cooldown and inspect the provider dashboard. Raising app budgets does not increase free provider entitlements. No setup step requires paying, adding a settlement signer, or turning on real-money flags.

`ADMIN_WALLETS` accepts public addresses separated by commas. Either verified linked wallet can grant the account admin access. Never supply a recovery phrase or wallet private key.
