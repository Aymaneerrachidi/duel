import { describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { combineSnapshots, portfolioAddress, PORTFOLIO_RULES_VERSION } from '../../packages/core/src/portfolio';
import { calculateDuelResult, timeWeightedReturn } from '../../packages/core/src/pnl';
import { CHAINS, type Chain } from '../../packages/core/src/config';
import type { Duel, Profile, Snapshot } from '../../packages/core/src/types';
import { Analytics } from '../../apps/worker/src/analytics';
import { MemoryRepository } from '../../apps/worker/src/repository';
import type { Rpc } from '../../apps/worker/src/providers/rpc';
import type { Prices } from '../../apps/worker/src/providers/prices';
import type { Transport } from '../../apps/worker/src/providers/transport';

const profile:Profile={id:'trader',wallet:'sol-address',chain:'solana',username:'trader',createdAt:1,following:[],demo:false,wallets:[{family:'solana',address:'sol-address',verifiedAt:1},{family:'evm',address:'0x123',verifiedAt:1}]};
const duel:Duel={id:'duel',slug:'DUEL',chain:'solana',chains:['solana','base'],portfolioWallets:{trader:structuredClone(profile.wallets!)},challenger:'trader',opponent:'rival',stake:'100',duration:86400000,createdAt:1000000,expiresAt:2000000,startsAt:1000000,endsAt:87400000,status:'ACTIVE',visibility:'PUBLIC',rulesVersion:PORTFOLIO_RULES_VERSION,demo:false,quality:'HIGH',issues:[],views:0,escrowMode:'simulated'};
function part(chain:Chain,totalUsd:string,timestamp=1000000):Snapshot{return {id:crypto.randomUUID(),duelId:duel.id,wallet:profile.id,chain,timestamp,block:'0x1',blockHash:'0xcanonical',totalUsd,positions:[],quality:'HIGH',issues:[],rulesVersion:duel.rulesVersion,transactionCoverage:true};}
describe('combined chain equity and evidence',()=>{
  it('weights returns by dollars and never averages chain percentages',()=>{
    const a=combineSnapshots(duel,profile,[part('solana','100'),part('base','900')]);
    const b=combineSnapshots(duel,profile,[part('solana','200'),part('base','900')]);
    expect(a.totalUsd).toBe('1000');expect(b.totalUsd).toBe('1100');expect(timeWeightedReturn(a.totalUsd,b.totalUsd)).toBe(10);
  });
  it('does not silently exclude a failed, missing, or duplicated chain',()=>{
    for(const parts of [[part('solana','100')],[part('solana','100'),part('solana','100')],[part('solana','100'),{...part('base','0'),quality:'INCOMPLETE' as const,issues:['RPC unavailable']}]] as Snapshot[][])expect(combineSnapshots(duel,profile,parts).quality).toBe('INCOMPLETE');
  });
  it('uses frozen wallet addresses when the profile changes later',()=>{
    const changed={...profile,wallets:[{family:'evm' as const,address:'0x456',verifiedAt:2}]};expect(portfolioAddress(duel,changed,'base')).toBe('0x123');expect(portfolioAddress(duel,changed,'solana')).toBe('sol-address');
  });
  it('retains each asset chain when identical contract addresses occur on two networks',()=>{
    const position={address:'native',symbol:'ETH',balance:'1',rawBalance:'1000000000000000000',decimals:18,price:null,valueUsd:'100',excludedUsd:'0'};
    const combined=combineSnapshots(duel,profile,[{...part('solana','100'),positions:[position]},{...part('base','100'),positions:[position]}]);
    expect(combined.positions.map(p=>`${p.chain}:${p.address}`)).toEqual(['solana:native','base:native']);
  });
  it('rejects manipulated totals and missing component evidence during final settlement',async()=>{
    const rival={...profile,id:'rival'},d={...duel,portfolioWallets:{trader:profile.wallets!,rival:profile.wallets!},finalityProofs:[{chain:'base' as const,block:'0x1',blockHash:'0xcanonical',checkedAt:1}]};
    const evidence=[profile,rival].flatMap(p=>[d.startsAt!,d.endsAt!].map(timestamp=>combineSnapshots(d,p,['solana','base'].map(chain=>({...part(chain as Chain,'100',timestamp),wallet:p.id})))));
    expect((await calculateDuelResult(d,evidence,[])).winner).toBeNull();
    const changed=structuredClone(evidence);changed[1].totalUsd='10000';await expect(calculateDuelResult(d,changed,[])).rejects.toThrow('does not reconcile');
    const missing=structuredClone(evidence);missing[1].components!.pop();await expect(calculateDuelResult(d,missing,[])).rejects.toThrow('Missing or duplicate');
  });
  it('does not apply a single-chain transfer denominator to the combined portfolio',async()=>{
    const analytics=new Analytics(()=>({}) as Rpc,{} as Prices,new MemoryRepository(),{} as Transport);
    const realReconcile=analytics.reconcile.bind(analytics);
    vi.spyOn(analytics,'reconcile').mockImplementation(async(d,...args)=>d.chains?realReconcile(d,...args):{flows:d.chain==='solana'?[{id:'flow',duelId:d.id,wallet:profile.id,txHash:'tx',timestamp:1000010,amountUsd:'100',beforeValueUsd:'100',afterValueUsd:'200',classification:'INFLOW',reason:'Chain-only transfer'}]:[],transactions:[],issues:[]});
    const before=combineSnapshots(duel,profile,[part('solana','100'),part('base','900')]),after=combineSnapshots(duel,profile,[part('solana','200'),part('base','900')]);
    const r=await analytics.reconcile(duel,profile,before,after);expect(r.flows[0].classification).toBe('CLASSIFICATION_PENDING');expect(r.issues.join()).toContain('whole-portfolio');
    expect(()=>timeWeightedReturn(before.totalUsd,after.totalUsd,r.flows)).toThrow('Unresolved');
  });
  it('counts Arc native USDC once and preserves native 18-decimal precision',async()=>{
    const now=Date.now(),rpc={balances:async()=>({block:'0x1',timestamp:now,native:{address:CHAINS.arc.native,raw:'100000000000000000000',balance:'100',decimals:18,symbol:'USDC'},tokens:[{address:CHAINS.arc.native,raw:'100000000',balance:'100',decimals:6,symbol:'USDC'}],issues:[]})};
    const prices={getTokenPrices:async()=>new Map(),getNativePrice:async()=>({chain:'arc',address:CHAINS.arc.native,symbol:'USDC',usd:'0.999',liquidity:'10000000',volume24h:'100000',source:'test',pool:'pool',timestamp:now,observedAt:now,confidence:'HIGH',divergence:0})};
    const analytics=new Analytics(()=>rpc as unknown as Rpc,prices as unknown as Prices,new MemoryRepository(),{} as Transport);
    const result=await analytics.snapshot({...duel,chain:'arc',chains:undefined,startsAt:undefined},profile);
    expect(result.positions).toHaveLength(1);expect(result.positions[0].decimals).toBe(18);expect(result.totalUsd).toBe('99.9');
  });
  it('values a transfer against all chains and charges its fee against performance',async()=>{
    const repo=new MemoryRepository(),timestamp=1000010;
    const position=(balance:string)=>({address:'native',symbol:'TEST',balance,rawBalance:new Decimal(balance).mul(1e9).toFixed(0),decimals:9,price:null,valueUsd:new Decimal(balance).mul(100).toString(),excludedUsd:'0'});
    await repo.transact(s=>{for(const chain of ['solana','base'] as const)s.prices.push({id:chain,chain,address:CHAINS[chain].native,symbol:'TEST',usd:'100',liquidity:'10000000',volume24h:'100000',source:'recorded',pool:'pool',timestamp:timestamp-1000,observedAt:timestamp-1000,confidence:'HIGH',divergence:0});});
    const components=[{...part('solana','100'),positions:[position('1')]},{...part('base','900'),positions:[position('9')]}];
    const before=combineSnapshots(duel,profile,components),after=combineSnapshots(duel,profile,components.map(s=>({...s,timestamp:1000020})));
    const analytics=new Analytics(()=>({}) as Rpc,{} as Prices,repo,{} as Transport);
    const result=await analytics.valueTransfers(duel,profile,before,after,[{record:{id:'f',duelId:duel.id,wallet:profile.id,chain:'solana',hash:'tx',block:'1',timestamp,classification:'TRANSFER',reason:'deposit'},before:new Map([['native',position('1')]]),after:new Map([['native',position('1.99')]]),fee:new Decimal('.01'),order:0}]);
    expect(result.issues).toEqual([]);expect(result.flows[0].beforeValueUsd).toBe('999');expect(result.flows[0].afterValueUsd).toBe('1099');expect(result.flows[0].amountUsd).toBe('100');
    expect(timeWeightedReturn('1000','1099',result.flows)).toBeCloseTo(-.1);
  });
});
