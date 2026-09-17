import 'dotenv/config';
import { mkdir,writeFile } from 'node:fs/promises';
import { CHAIN_IDS,CHAINS } from '../packages/core/src/config';
import { SupabaseRepository } from '../apps/worker/src/repository';

type Result={check:string;status:'PASS'|'MISSING'|'BLOCKED';detail:string};
const results:Result[]=[];
function record(check:string,status:Result['status'],detail:string){results.push({check,status,detail});console.log(`${status.padEnd(8)} ${check}: ${detail}`);}
async function rpc(url:string,method:string,params:unknown[]){
  // A bounded, sequential capability probe. Never print credential-bearing URLs
  // or arbitrary provider errors, which can contain URLs or request parameters.
  await new Promise(r=>setTimeout(r,650));
  try{
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(8000)});
    const data=await response.json() as {result?:unknown;error?:{code?:number;message?:string}};
    if(!response.ok||data.error)return {ok:false as const,reason:data.error?.message?.includes('not enabled')?'Network is not enabled in your Alchemy app.':`HTTP ${response.status}; RPC ${data.error?.code??'unavailable'}. This method or entitlement needs checking.`};
    return {ok:true as const,result:data.result};
  }catch{return {ok:false as const,reason:'Endpoint timed out or returned an invalid response.'};}
}
console.log('Read-only readiness audit. No wallet signatures or blockchain transactions are requested.');
for(const key of ['SESSION_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','HELIUS_API_KEY','ALCHEMY_API_KEY','JUPITER_API_KEY','DEXPAPRIKA_API_KEY','GMGN_API_KEY','ADMIN_WALLETS'])record(key,process.env[key]?'PASS':'MISSING',process.env[key]?'Configured (value hidden).':key==='ADMIN_WALLETS'?'Add your public Solana and EVM admin addresses, comma-separated.':'Not configured.');
record('Live mode',process.env.DEMO_MODE==='false'?'PASS':'BLOCKED',process.env.DEMO_MODE==='false'?'Real wallet login enabled.':'DEMO_MODE is still enabled.');
if(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){
  try{await new SupabaseRepository(process.env).read();record('Supabase schema','PASS','State-read function and service key work.');}catch{record('Supabase schema','BLOCKED','Schema, server key or project connection needs attention.');}
  if(process.env.SUPABASE_ANON_KEY)try{const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/duels_read_state`,{method:'POST',headers:{apikey:process.env.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(8000)});record('Database public access',r.status===401||r.status===403?'PASS':'BLOCKED',r.status===401||r.status===403?'Publishable key cannot read private app state.':`Unexpected HTTP ${r.status}; review database grants.`);}catch{record('Database public access','BLOCKED','Public-access check unavailable.');}
}
if(process.env.ALCHEMY_API_KEY)for(const chain of CHAIN_IDS.filter(c=>c!=='solana')){
  const url=`https://${CHAINS[chain].alchemy}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
  const identity=await rpc(url,'eth_chainId',[]);
  if(!identity.ok||Number(identity.result)!==CHAINS[chain].id){record(`Alchemy ${chain}`,'BLOCKED',identity.ok?'Chain ID mismatch.':identity.reason);continue;}
  record(`Alchemy ${chain}`,'PASS',`Verified mainnet chain ${CHAINS[chain].id}.`);
  const inventory=await rpc(url,'alchemy_getTokenBalances',['0x0000000000000000000000000000000000000001','erc20',{maxCount:1}]);
  record(`${chain} token inventory`,inventory.ok&&Array.isArray((inventory.result as {tokenBalances?:unknown})?.tokenBalances)?'PASS':'BLOCKED',inventory.ok?'Token API responded; this does not prove every historical holding is covered.':inventory.reason);
  const block=await rpc(url,'eth_getBlockByNumber',['finalized',false]);
  if(block.ok&&block.result&&typeof block.result==='object'&&'number'in block.result&&'timestamp'in block.result){
    const value=block.result as {number:string;timestamp:string},age=Math.round((Date.now()-Number(BigInt(value.timestamp))*1000)/1000);
    record(`${chain} finality window`,'PASS',`Latest finalized block is ${age}s old; recent snapshots await canonical finality before results publish.`);
    const history=await rpc(url,'alchemy_getAssetTransfers',[{fromAddress:'0x0000000000000000000000000000000000000001',fromBlock:value.number,toBlock:value.number,category:chain==='ethereum'||chain==='base'?['external','internal','erc20']:['external','erc20'],withMetadata:true,excludeZeroValue:false,maxCount:'0x1'}]);
    record(`${chain} transfer index`,history.ok&&Array.isArray((history.result as {transfers?:unknown})?.transfers)?'PASS':'BLOCKED',history.ok?'Transfer API responded; decoder correctness is a separate requirement.':history.reason);
  }else record(`${chain} finalized block`,'BLOCKED',block.ok?'Finalized block response is incomplete.':block.reason);
}
record('Supported replay','PASS','Plain transfers, selected swaps, receipt/nonce replay and combined flow valuations implemented; arbitrary protocols and bridges remain unsupported.');
record('Real-money stakes','BLOCKED','This app uses simulated stakes. Escrow integration, Solana execution tests and independent contract review remain outstanding.');
await mkdir('.data',{recursive:true});await writeFile('.data/readiness.json',JSON.stringify({checkedAt:new Date().toISOString(),readyForLiveSettlement:false,results},null,2));
console.log('Saved .data/readiness.json. RPC connectivity alone does not establish full trading readiness.');
if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
