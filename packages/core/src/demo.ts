// All illustrative wallets, prices, events and returns live in this module.
// Never import this as a fallback for a failed live provider.
import { CHAINS, RULES, type Chain } from './config.js';
import { emptyState, type Duel, type Profile, type Snapshot, type State } from './types.js';
import { calculateDuelResult } from './pnl.js';
import { combineSnapshots } from './portfolio.js';
const DAY=86400000;
export const DEMO_PEOPLE = [
  {username:'gyro',chain:'solana',wallet:'DemoGyro111111111111111111111111111111111111'},
  {username:'orangie',chain:'solana',wallet:'DemoOrangie111111111111111111111111111111111'},
  {username:'ansem',chain:'solana',wallet:'DemoAnsem11111111111111111111111111111111111'},
  {username:'bonkler',chain:'solana',wallet:'DemoBonkler111111111111111111111111111111111'},
  {username:'0xflair',chain:'base',wallet:'0x0000000000000000000000000000000000000011'},
  {username:'based',chain:'base',wallet:'0x0000000000000000000000000000000000000022'},
  {username:'hoodl',chain:'robinhood',wallet:'0x0000000000000000000000000000000000000033'},
  {username:'robin',chain:'robinhood',wallet:'0x0000000000000000000000000000000000000044'},
  {username:'czs_jacket',chain:'bnb',wallet:'0x0000000000000000000000000000000000000055'},
  {username:'fourmeme',chain:'bnb',wallet:'0x0000000000000000000000000000000000000066'},
  {username:'etherian',chain:'ethereum',wallet:'0x0000000000000000000000000000000000000077'},
  {username:'0xwave',chain:'ethereum',wallet:'0x0000000000000000000000000000000000000088'},
  {username:'you',chain:'solana',wallet:'DemoYou1111111111111111111111111111111111111'},
] as const;
export function demoSnapshot(duel:Duel, profile:Profile, timestamp:number, returnPct:number):Snapshot {
  if(duel.chains){const result=combineSnapshots(duel,profile,duel.chains.map(chain=>demoSnapshot({...duel,chain,chains:undefined},profile,timestamp,returnPct)));return {...result,returnPct};}
  const initial=profile.username==='gyro'?2482.18:profile.username==='orangie'?6129.42:1800+(profile.username.length*389);
  const total=initial*(1+returnPct/100); const assets=duel.chain==='solana'?[['SOL',0.34,142.8],['WIF',0.28,1.34],['USDC',0.22,1],['BONK',0.16,0.000023]]:duel.chain==='arc'?[['USDC',0.8,1],['EURC',0.2,1.1]]: [[CHAINS[duel.chain].symbol,0.62,duel.chain==='bnb'?620:3420],['USDC',0.26,1],['PEPE',0.12,0.000012]];
  return {id:`demo-${duel.id}-${profile.id}-${duel.chain}-${timestamp}`,duelId:duel.id,wallet:profile.id,chain:duel.chain,timestamp,block:`demo-${Math.floor(timestamp/400)}`,totalUsd:total.toFixed(8),quality:'HIGH',issues:[],rulesVersion:duel.rulesVersion,returnPct,transactionCoverage:true,
    positions:assets.map(([symbol,share,usd])=>({address:`demo-${symbol}`,symbol:String(symbol),balance:(total*Number(share)/Number(usd)).toFixed(9),rawBalance:'0',decimals:9,valueUsd:(total*Number(share)).toFixed(8),excludedUsd:'0',price:{chain:duel.chain,address:`demo-${symbol}`,symbol:String(symbol),usd:String(usd),liquidity:'50000000',volume24h:'4000000',source:'DEMO',pool:'demo-pool',timestamp,observedAt:timestamp,confidence:'HIGH',divergence:0}}))};
}
export async function seedDemo(now=Date.now()):Promise<State>{
  const s=emptyState();
  s.profiles=DEMO_PEOPLE.map(p=>({...p,id:`demo-${p.username}`,createdAt:now-90*DAY,following:[],demo:true}));
  for(const p of s.profiles) s.ledger.push({id:`grant-${p.id}`,profileId:p.id,delta:RULES.initialPoints,reason:'Demo starting points',createdAt:now});
  for(let i=0;i<30;i++){
    const pair=(i%6)*2;const a=s.profiles[pair],b=s.profiles[pair+1];const startsAt=now-(35-i)*DAY;
    const d:Duel={id:`demo-history-${i}`,slug:`FINAL${i}`,chain:a.chain as Chain,challenger:a.id,opponent:b.id,stake:i%2?'0.5':'1',duration:DAY,createdAt:startsAt-60000,expiresAt:startsAt+DAY,startsAt,endsAt:startsAt+DAY,status:'COMPLETED',visibility:'PUBLIC',rulesVersion:RULES.version,demo:true,quality:'HIGH',issues:[],views:0,escrowMode:'simulated'};
    const ra= i%4===0?-8.3:(i*7.19)%55+4.5; const rb=(i*4.2)%34-5;
    for(const [p,r] of [[a,ra],[b,rb]] as const) for(let n=0;n<=12;n++) s.snapshots.push(demoSnapshot(d,p,startsAt+n*DAY/12,r*n/12));
    Object.assign(d,await calculateDuelResult(d,s.snapshots,[]));delete (d as unknown as Record<string,unknown>).evidence;s.duels.push(d);
  }
  const returns=[[38.47,21.02],[17.26,-4.82],[12.64,16.31],[-2.19,8.71],[6.92,4.28],[22.15,18.43]];
  for(let i=0;i<6;i++){
    const a=s.profiles[i*2],b=s.profiles[i*2+1];const duration=7*DAY; const startsAt=now-(2.43+i*0.21)*DAY;
    const d:Duel={id:`demo-live-${i}`,slug:i===0?'GYRO7D':`LIVE0${i}`,chain:a.chain,challenger:a.id,opponent:b.id,stake:i===0?'1':i===1?'2':i===2?'0.1':'0.5',duration,createdAt:startsAt-3600000,expiresAt:startsAt+DAY,startsAt,endsAt:startsAt+duration,status:'ACTIVE',visibility:'PUBLIC',rulesVersion:RULES.version,demo:true,quality:'HIGH',issues:[],lastUpdated:now,views:0,escrowMode:'simulated',challengerReturn:returns[i][0],opponentReturn:returns[i][1]};
    for(const [p,r] of [[a,returns[i][0]],[b,returns[i][1]]] as const)for(let n=0;n<=36;n++){const t=n/36;const v=n===36?r:r*t+Math.sin(n*1.8)*(t*1.5);s.snapshots.push(demoSnapshot(d,p,Math.round(startsAt+(now-startsAt)*t),v));}
    s.duels.push(d);s.events.push({id:`event-${d.id}`,duelId:d.id,type:'STARTED',text:`@${b.username} accepted @${a.username}'s challenge. The clock is running.`,createdAt:startsAt});
    for(let j=0;j<8;j++){const p=s.profiles.find((p,k)=>k===(j+3)%s.profiles.length && p.id!==a.id && p.id!==b.id);if(!p)continue;const points=100+(j%3)*100;s.predictions.push({id:`demo-pred-${i}-${j}`,duelId:d.id,profileId:p.id,side:j%3===0?b.id:a.id,points,createdAt:startsAt+1000});s.ledger.push({id:`bet-${i}-${j}`,profileId:p.id,delta:-points,reason:'Demo prediction',duelId:d.id,createdAt:startsAt+1000});}
  }
  s.duels.push({id:'demo-open',slug:'CALLOUT',chain:'solana',challenger:'demo-ansem',opponent:'demo-you',stake:'1',duration:7*DAY,createdAt:now-3600000,expiresAt:now+23*3600000,status:'OPEN',visibility:'PUBLIC',rulesVersion:RULES.version,demo:true,quality:'HIGH',issues:[],views:0,escrowMode:'simulated'});
  return s;
}
