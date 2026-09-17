import { describe,it,expect } from 'vitest';
import { Analytics } from '../../apps/worker/src/analytics';
import { Rpc } from '../../apps/worker/src/providers/rpc';
import { Prices } from '../../apps/worker/src/providers/prices';
import { QuotaManager,Transport } from '../../apps/worker/src/providers/transport';
import { MemoryRepository } from '../../apps/worker/src/repository';
import { RULES,CHAINS } from '../../packages/core/src/config';
import type { Duel,Profile,Price } from '../../packages/core/src/types';
const now=Date.now(),blockTime=now-20000;
class SnapshotRpc extends Rpc {override async balances(){return {block:'1234',timestamp:blockTime,native:{address:CHAINS.solana.native,raw:'1000000000',decimals:9,balance:'1',symbol:'SOL'},tokens:[{address:CHAINS.solana.native,raw:'2000000000',decimals:9,balance:'2',symbol:'WSOL',account:'tokenAccount'}],issues:[]};}}
class SnapshotPrices extends Prices {
  constructor(http:Transport,repo:MemoryRepository,private time:number){super(http,repo,{});}
  quote():Price{return {chain:'solana',address:CHAINS.solana.native,symbol:'SOL',usd:'100',liquidity:'10000000',volume24h:'100000',source:'test observation',pool:'pool',poolCreatedAt:now-86400000,timestamp:this.time,observedAt:this.time,confidence:'HIGH',divergence:0};}
  override async getTokenPrices(){return new Map([[CHAINS.solana.native,this.quote()]]);}
  override async getNativePrice(){return this.quote();}
}
async function snapshot(time:number){const repo=new MemoryRepository(),http=new Transport(new QuotaManager(repo,{}));const rpc=new SnapshotRpc('solana',{},http);return new Analytics(()=>rpc,new SnapshotPrices(http,repo,time),repo,http).snapshot({id:'duel',chain:'solana',rulesVersion:RULES.version} as Duel,{id:'profile',wallet:'wallet'} as Profile);}
describe('finalized snapshot accounting',()=>{
  it('preserves the block timestamp and separate native/wrapped balances',async()=>{const result=await snapshot(blockTime-1000);expect(result.timestamp).toBe(blockTime);expect(result.positions).toHaveLength(2);expect(result.positions.find(p=>p.address==='native')?.balance).toBe('1');expect(result.totalUsd).toBe('300');expect(result.quality).toBe('HIGH');});
  it('refuses a fresh quote newer than the finalized block instead of backdating it',async()=>{const result=await snapshot(now);expect(result.quality).toBe('INCOMPLETE');expect(result.totalUsd).toBe('0');expect(result.positions[0].price?.timestamp).toBe(now);});
});
