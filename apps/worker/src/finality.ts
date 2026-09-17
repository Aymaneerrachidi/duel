import { z } from 'zod';
import type { Chain } from '../../../packages/core/src/config.js';
import type { FinalityProof, IndexedTransaction, Snapshot } from '../../../packages/core/src/types.js';
import type { Rpc } from './providers/rpc.js';

export async function verifyFinality(rpcFor:(chain:Chain)=>Rpc,snapshots:Snapshot[],transactions:IndexedTransaction[],cached:FinalityProof[]=[]){
  const required=new Map<string,{chain:Chain;block:string;blockHash?:string}>();
  for(const s of snapshots.flatMap(s=>s.components??[s]))if(s.chain!=='solana')required.set(`${s.chain}:${s.block}`,s);
  for(const tx of transactions)if(tx.chain!=='solana'){
    const key=`${tx.chain}:${tx.block}`,prior=required.get(key);
    if(prior?.blockHash&&tx.blockHash&&prior.blockHash!==tx.blockHash)throw new Error(`Conflicting block evidence for ${key}`);
    required.set(key,{...tx,blockHash:tx.blockHash??prior?.blockHash});
  }
  const proofs=[...cached],pending:string[]=[];
  const heads=new Map<Chain,bigint>();
  const blockSchema=z.object({number:z.string(),hash:z.string()});
  let reads=0;
  for(const [key,record] of required){
    if(!record.blockHash)throw new Error(`Block hash missing for ${key}`);
    if(proofs.some(p=>p.chain===record.chain&&p.block===record.block&&p.blockHash===record.blockHash))continue;
    if(reads++>=48){pending.push(record.chain);continue;}
    const rpc=rpcFor(record.chain);
    try{
      if(!heads.has(record.chain))heads.set(record.chain,BigInt(blockSchema.parse(await rpc.getBlock('finalized')).number));
      if(heads.get(record.chain)!<BigInt(record.block)){pending.push(record.chain);continue;}
      const canonical=blockSchema.parse(await rpc.getBlock(record.block));
      if(canonical.hash!==record.blockHash)throw new ReorgError(`Canonical block changed on ${record.chain}; recorded evidence needs review`);
      proofs.push({chain:record.chain,block:record.block,blockHash:canonical.hash,checkedAt:Date.now()});
    }catch(error){if(error instanceof ReorgError)throw error;pending.push(record.chain);}
  }
  return {proofs,pending:[...new Set(pending)]};
}
class ReorgError extends Error {}
