import { describe,it,expect,vi } from 'vitest';
import { verifyFinality } from '../../apps/worker/src/finality';
import type { Rpc } from '../../apps/worker/src/providers/rpc';
import type { Snapshot } from '../../packages/core/src/types';
const snapshot={chain:'base',block:'0x20',blockHash:'0xabc'} as Snapshot;
describe('canonical settlement evidence',()=>{
  it('keeps recent snapshots pending until the finalized head passes them',async()=>{
    const getBlock=vi.fn(async()=>({number:'0x10',hash:'0xold'}));
    const result=await verifyFinality(()=>({getBlock}) as unknown as Rpc,[snapshot],[]);
    expect(result.pending).toEqual(['base']);expect(result.proofs).toEqual([]);expect(getBlock).toHaveBeenCalledTimes(1);
  });
  it('records matching finalized hashes and reuses verified proofs',async()=>{
    const getBlock=vi.fn(async()=>({number:'0x30',hash:'0xabc'})),rpc=()=>({getBlock}) as unknown as Rpc;
    const result=await verifyFinality(rpc,[snapshot],[]);expect(result.pending).toEqual([]);expect(result.proofs).toHaveLength(1);
    getBlock.mockClear();expect(await verifyFinality(rpc,[snapshot],[],result.proofs)).toEqual(result);expect(getBlock).not.toHaveBeenCalled();
  });
  it('rejects reorganized or conflicting evidence instead of declaring a winner',async()=>{
    const rpc=()=>({getBlock:async()=>({number:'0x30',hash:'0xchanged'})}) as unknown as Rpc;
    await expect(verifyFinality(rpc,[snapshot],[])).rejects.toThrow('Canonical block changed');
    await expect(verifyFinality(rpc,[{...snapshot,blockHash:undefined}],[])).rejects.toThrow('Block hash missing');
  });
  it('retains pending state when providers cannot establish finality',async()=>{
    const result=await verifyFinality(()=>({getBlock:async()=>{throw new Error('Unavailable');}}) as unknown as Rpc,[snapshot],[]);
    expect(result.pending).toEqual(['base']);expect(result.proofs).toEqual([]);
  });
});
