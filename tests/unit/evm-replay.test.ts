import { describe,it,expect } from 'vitest';
import Decimal from 'decimal.js';
import { encodeFunctionData,parseAbi } from 'viem';
import { classifyEvm,replayEvm } from '../../apps/worker/src/evm-replay';
import type { Position,Snapshot } from '../../packages/core/src/types';
import type { Rpc } from '../../apps/worker/src/providers/rpc';

const wallet='0x1111111111111111111111111111111111111111',other='0x2222222222222222222222222222222222222222',asset='0x3333333333333333333333333333333333333333';
const position=(address:string,balance:string):Position=>({address,balance,rawBalance:new Decimal(balance).mul('1e18').toFixed(0),decimals:18,symbol:'TEST',price:null,valueUsd:'0',excludedUsd:'0'});
const balances=(native:string,token='0')=>new Map([['native',position('native',native)],[asset,position(asset,token)]]);
const tx={hash:'0xtx',from:wallet,to:other,value:'0x0',input:'0x',nonce:'0x0',blockNumber:'0x2',blockHash:'0xblock',transactionIndex:'0x0'};
describe('EVM transaction replay',()=>{
  it('accounts for approvals and failed transactions as performance costs',()=>{
    expect(classifyEvm(tx,false,'ethereum',wallet,balances('1'),balances('0.99'),new Decimal('.01')).classification).toBe('FEE');
    expect(()=>classifyEvm(tx,false,'ethereum',wallet,balances('1'),balances('0.98'),new Decimal('.01'))).toThrow('beyond its fee');
    const approval={...tx,input:'0x095ea7b3'+'0'.repeat(128)};
    expect(classifyEvm(approval,true,'ethereum',wallet,balances('1'),balances('.99'),new Decimal('.01')).classification).toBe('FEE');
  });
  it('accepts known decoded swaps returning output to the trader',()=>{
    const abi=parseAbi(['function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)']);
    const output='0x4444444444444444444444444444444444444444';
    const input=encodeFunctionData({abi,functionName:'swapExactTokensForTokens',args:[1000000000000000000n,1n,[asset,output],wallet,9999999999n]});
    const before=balances('1','2'),after=balances('.99','1');after.set(output,position(output,'4'));
    const swap={...tx,to:'0x7a250d5630b4cf539739df2c5dacb4c659f2488d',input};
    expect(classifyEvm(swap,true,'ethereum',wallet,before,after,new Decimal('.01')).classification).toBe('SWAP');
    after.set(other,position(other,'10'));expect(()=>classifyEvm(swap,true,'ethereum',wallet,before,after,new Decimal('.01'))).toThrow('unexplained');
  });
  it('does not classify bridge or unknown contract calls as swaps',()=>{
    expect(()=>classifyEvm({...tx,input:'0x12345678'},true,'ethereum',wallet,balances('1'),balances('.5'),new Decimal('.01'))).toThrow('bridge');
  });
  it('verifies exact transfer calldata instead of treating unrelated credits as performance',()=>{
    const input=encodeFunctionData({abi:parseAbi(['function transfer(address to,uint256 amount)']),functionName:'transfer',args:[other,1000000000000000000n]});
    expect(classifyEvm({...tx,to:asset,input},true,'ethereum',wallet,balances('1','2'),balances('.99','1'),new Decimal('.01')).classification).toBe('TRANSFER');
    expect(()=>classifyEvm({...tx,to:asset,input},true,'ethereum',wallet,balances('1','2'),balances('.99','3'),new Decimal('.01'))).toThrow('unexplained');
  });
  function mockRpc(missingInflow=false){
    const ownTx={...tx,value:'0xde0b6b3a7640000'};
    return {chain:'ethereum',call:async(method:string,params:unknown[])=>{
      if(method==='eth_getCode')return '0x';
      if(method==='eth_getTransactionCount')return params[1]==='0x1'?'0x0':'0x1';
      if(method==='eth_getBlockByNumber')return {transactions:[ownTx]};
      if(method==='eth_getLogs')return [];
      throw new Error('Unexpected method');
    },getTokenTransfers:async()=>[],getTransaction:async()=>ownTx,
    getReceipt:async()=>({transactionHash:tx.hash,blockNumber:'0x2',blockHash:tx.blockHash,status:'0x1',gasUsed:'0x5208',effectiveGasPrice:'0x1',logs:[]}),
    getBlock:async()=>({hash:tx.blockHash,timestamp:'0x65'}),missingInflow} as unknown as Rpc;
  }
  const snapshot=(block:string,native:string):Snapshot=>({id:block,duelId:'d',wallet:'p',chain:'ethereum',timestamp:100000,block,blockHash:tx.blockHash,totalUsd:'100',positions:[position('native',native)],quality:'HIGH',issues:[],rulesVersion:'twr-v1',transactionCoverage:true});
  it('discovers an outgoing transaction through nonce coverage and verifies its fee and final balance',async()=>{
    const end=new Decimal(2).minus(1).minus(new Decimal(21000).div('1e18')).toString();
    const result=await replayEvm(mockRpc(),wallet,snapshot('0x1','2'),snapshot('0x2',end),'d','p');
    expect(result.issues).toEqual([]);expect(result.events).toHaveLength(1);expect(result.transactions[0].classification).toBe('TRANSFER');
  });
  it('refuses an unexplained native credit even if transfer discovery returned no error',async()=>{
    const result=await replayEvm(mockRpc(),wallet,snapshot('0x1','2'),snapshot('0x2','2'),'d','p');
    expect(result.issues.join()).toContain('does not reconcile');
  });
});
