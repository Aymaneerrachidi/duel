import 'dotenv/config';
import { mkdir,writeFile } from 'node:fs/promises';
import { CHAIN_IDS,CHAINS } from '../packages/core/src/config';
import { MemoryRepository } from '../apps/worker/src/repository';
import { QuotaManager,Transport } from '../apps/worker/src/providers/transport';
import { Rpc } from '../apps/worker/src/providers/rpc';
import { Prices } from '../apps/worker/src/providers/prices';
import { GmgnProvider } from '../apps/worker/src/providers/gmgn';
import { SupabaseRepository } from '../apps/worker/src/repository';
const repo=new MemoryRepository();const http=new Transport(new QuotaManager(repo,process.env));const prices=new Prices(http,repo,process.env);
const results:{provider:string;status:string;detail:string;durationMs:number}[]=[];
async function probe(provider:string,task:()=>Promise<string>){const start=Date.now();try{results.push({provider,status:'PASS',detail:await task(),durationMs:Date.now()-start});}catch{results.push({provider,status:'UNAVAILABLE',detail:'Check the configured endpoint, entitlement, chain support, or provider status. No secret URL is logged.',durationMs:Date.now()-start});}console.log(`${results.at(-1)!.status.padEnd(12)} ${provider}: ${results.at(-1)!.detail}`);}
console.log('Read-only provider checks. No accounts, wallet signatures, paid plans, or transactions are created.');
if(process.env.HELIUS_API_KEY)await probe('Helius credential (no fallback)',async()=>{if(await new Rpc('solana',process.env,http).call('getHealth',[],'optional','helius')!=='ok')throw new Error();return 'Your Helius endpoint responded healthy.';});
if(process.env.ALCHEMY_API_KEY)for(const chain of ['base','bnb','ethereum','robinhood','arc'] as const)await probe(`Alchemy ${chain} credential (no fallback)`,async()=>{if(Number(await new Rpc(chain,process.env,http).call('eth_chainId',[],'optional','alchemy'))!==CHAINS[chain].id)throw new Error();return 'Your Alchemy key matched the requested network.';});
if(process.env.JUPITER_API_KEY)await probe('Jupiter credential',async()=>{const result=await http.json<Record<string,{usdPrice?:number}>>('jupiter',`https://api.jup.ag/price/v3?ids=${CHAINS.solana.native}`,{headers:{'x-api-key':process.env.JUPITER_API_KEY!},ttl:45000});if(!result[CHAINS.solana.native]?.usdPrice)throw new Error();return 'Your key returned a wrapped SOL reference price.';});
if(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY)await probe('Supabase migrations and server key',async()=>{await new SupabaseRepository(process.env).read();return 'Atomic state-read RPC is accessible using the server key.';});
for(const chain of CHAIN_IDS){await probe(`${CHAINS[chain].name} RPC`,async()=>{const healthy=await new Rpc(chain,process.env,http).healthCheck();if(!healthy)throw new Error();return chain==='solana'?'RPC responded healthy.':`RPC matched chain ID ${CHAINS[chain].id}.`;});}
for(const chain of ['solana','base','bnb','ethereum','arc'] as const)await probe(`${CHAINS[chain].name} native price`,async()=>{const p=await prices.getNativePrice(chain);if(!p)throw new Error();return `${p.source}: ${p.symbol} has a price and $${Math.round(Number(p.liquidity)).toLocaleString()} reference liquidity.`;});
await probe('GeckoTerminal',async()=>{const r=await http.json<{data:unknown[]}>('geckoterminal','https://api.geckoterminal.com/api/v2/networks/solana/tokens/So11111111111111111111111111111111111111112/pools?page=1');if(!Array.isArray(r.data)||!r.data.length)throw new Error();return 'Solana wrapped-native pools returned.';});
await probe('DexPaprika',async()=>{const r=await http.json<{symbol?:string}>('dexpaprika',`https://api.dexpaprika.com/networks/bsc/tokens/${CHAINS.bnb.native}`,{headers:process.env.DEXPAPRIKA_API_KEY?{Authorization:process.env.DEXPAPRIKA_API_KEY}:{}});if(!r.symbol)throw new Error();return `${r.symbol} metadata returned from the free API host.`;});
if(process.env.GMGN_API_KEY&&process.env.GMGN_FREE_ACCESS_CONFIRMED==='true')for(const chain of ['solana','arc'] as const)await probe(`GMGN ${chain}`,async()=>{const r=await new GmgnProvider(http,process.env).trending(chain);if(!r.available)throw new Error();return `${r.tokens.length} market records returned using your configured key.`;});else results.push({provider:'GMGN',status:'NOT CONFIGURED',detail:'Your own key and explicit free read entitlement are required. No public demo key used.',durationMs:0});
await mkdir('.data',{recursive:true});await writeFile('.data/provider-check.json',JSON.stringify({checkedAt:new Date().toISOString(),results,estimatedUsage:(await repo.read()).usage},null,2));
console.log('\nReport: .data/provider-check.json. A smoke test does not establish sustained quota capacity or historical coverage.');
if(results.some(r=>r.status==='UNAVAILABLE'))process.exitCode=1;
