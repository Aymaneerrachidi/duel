import Decimal from 'decimal.js';
import bs58 from 'bs58';
import { sha256, toBytes } from 'viem';
import { z } from 'zod';
import type { Position } from '../../../packages/core/src/types.js';

const instruction=z.object({programId:z.string(),accounts:z.array(z.string()).optional(),data:z.string().optional(),parsed:z.object({type:z.string(),info:z.record(z.string(),z.unknown())}).optional()});
const tokenBalance=z.object({accountIndex:z.number(),mint:z.string(),owner:z.string().optional(),uiTokenAmount:z.object({amount:z.string(),decimals:z.number()})});
export const solanaTransaction=z.object({blockTime:z.number().nullable(),slot:z.number(),transaction:z.object({message:z.object({accountKeys:z.array(z.union([z.string(),z.object({pubkey:z.string(),signer:z.boolean().optional()})])),instructions:z.array(instruction)})}),meta:z.object({err:z.unknown(),fee:z.number().int().nonnegative(),preBalances:z.array(z.number().int().nonnegative()),postBalances:z.array(z.number().int().nonnegative()),preTokenBalances:z.array(tokenBalance).optional(),postTokenBalances:z.array(tokenBalance).optional(),innerInstructions:z.array(z.object({index:z.number(),instructions:z.array(instruction)})).optional()}).nullable()});
const SYSTEM='11111111111111111111111111111111';
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const COMPUTE='ComputeBudget111111111111111111111111111111';
const JUPITER='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
// Account layouts from Jupiter's official instruction-parser IDL, checked 2026-09-17.
const routes=['route','exact_out_route','shared_accounts_route','shared_accounts_exact_out_route'].map(name=>({
  discriminator:toBytes(sha256(toBytes(`global:${name}`))).slice(0,8),
  authority:name.startsWith('shared_')?2:1,source:name.startsWith('shared_')?3:2,destination:name.startsWith('shared_')?6:3,
}));
export function replaySolana(raw:unknown,wallet:string,running:Map<string,Position>){
  const tx=solanaTransaction.parse(raw);if(!tx.meta||!tx.blockTime)throw new Error('Missing finalized transaction evidence');
  const meta=tx.meta,keys=tx.transaction.message.accountKeys.map(k=>typeof k==='string'?k:k.pubkey),owner=keys.indexOf(wallet);
  const after=new Map([...running].map(([k,v])=>[k,{...v}]));
  const native=after.get('native');if(!native)throw new Error('Native balance evidence missing');
  if(owner>=0){
    if(!Number.isSafeInteger(meta.preBalances[owner])||!Number.isSafeInteger(meta.postBalances[owner]))throw new Error('Unsafe native numeric precision');
    if(native.rawBalance!==String(meta.preBalances[owner]))throw new Error('Native balance replay gap');
    after.set('native',{...native,rawBalance:String(meta.postBalances[owner]),balance:new Decimal(meta.postBalances[owner]).div(1e9).toString()});
  }
  const deltas=new Map<string,{raw:Decimal;decimals:number}>();
  for(const [entries,sign] of [[meta.preTokenBalances??[],-1],[meta.postTokenBalances??[],1]] as const){
    for(const b of entries){if(b.owner!==wallet)continue;const previous=deltas.get(b.mint);if(previous&&previous.decimals!==b.uiTokenAmount.decimals)throw new Error('Token precision changed');deltas.set(b.mint,{decimals:b.uiTokenAmount.decimals,raw:(previous?.raw??new Decimal(0)).add(new Decimal(b.uiTokenAmount.amount).mul(sign))});}
  }
  for(const [mint,delta] of deltas){
    const p=after.get(mint)??{address:mint,symbol:mint.slice(0,6),decimals:delta.decimals,rawBalance:'0',balance:'0',price:null,valueUsd:'0',excludedUsd:'0'};
    const raw=new Decimal(p.rawBalance).add(delta.raw);if(raw.lt(0))throw new Error('Token balance replay gap');
    after.set(mint,{...p,rawBalance:raw.toString(),balance:raw.div(new Decimal(10).pow(delta.decimals)).toString()});
  }
  const fee=keys[0]===wallet?new Decimal(meta.fee).div(1e9):new Decimal(0);
  if(meta.err){
    if([...deltas.values()].some(d=>!d.raw.isZero())||!new Decimal(native.balance).minus(after.get('native')!.balance).eq(fee))throw new Error('Failed transaction has unexpected balance changes');
    return {tx,after,fee,classification:'FEE' as const,reason:'Failed transaction fee counts against performance'};
  }
  const instructions=tx.transaction.message.instructions;
  const plain=instructions.every(i=>i.programId===COMPUTE||[SYSTEM,TOKEN].includes(i.programId)&&!!i.parsed&&['transfer','transferChecked'].includes(i.parsed.type));
  if(plain)return {tx,after,fee,classification:'TRANSFER' as const,reason:'Parsed plain transfer with full transaction-boundary valuation'};
  const swaps=instructions.filter(i=>i.programId===JUPITER);
  if(swaps.length!==1||instructions.some(i=>![JUPITER,COMPUTE].includes(i.programId)))throw new Error('Unsupported swap, account creation, wrapping or DeFi instructions');
  const swap=swaps[0];if(!swap.data||!swap.accounts)throw new Error('Missing Jupiter instruction data');
  const data=bs58.decode(swap.data),layout=routes.find(r=>r.discriminator.every((b,i)=>data[i]===b));
  if(!layout||data.length<20||swap.accounts[layout.authority]!==wallet)throw new Error('Unsupported Jupiter route or transfer authority');
  if(!tx.transaction.message.accountKeys.some(k=>typeof k!=='string'&&k.pubkey===wallet&&k.signer))throw new Error('Jupiter authority did not sign');
  const source=keys.indexOf(swap.accounts[layout.source]),destination=keys.indexOf(swap.accounts[layout.destination]);
  const input=meta.preTokenBalances?.find(b=>b.accountIndex===source&&b.owner===wallet);
  const output=meta.postTokenBalances?.find(b=>b.accountIndex===destination&&b.owner===wallet);
  if(!input||!output||input.mint===output.mint)throw new Error('Swap must return output to a verified account owned by this wallet');
  if([...deltas].some(([mint,d])=>!d.raw.isZero()&&![input.mint,output.mint].includes(mint))||!deltas.get(input.mint)?.raw.lt(0)||!deltas.get(output.mint)?.raw.gt(0))throw new Error('Unexpected swap asset changes');
  if(!new Decimal(native.balance).minus(after.get('native')!.balance).eq(fee))throw new Error('Swap contains an unexplained native transfer');
  return {tx,after,fee,classification:'SWAP' as const,reason:'Jupiter route discriminator, signer, owned input/output accounts and balance deltas verified'};
}
