import Decimal from 'decimal.js';
import { decodeFunctionData, parseAbi } from 'viem';
import { z } from 'zod';
import { CHAINS, type Chain } from '../../../packages/core/src/config.js';
import type { IndexedTransaction, Position, Snapshot } from '../../../packages/core/src/types.js';
import type { Rpc } from './providers/rpc.js';

const hex=z.string().regex(/^0x[0-9a-f]+$/i);
const logSchema=z.object({address:z.string(),topics:z.array(z.string()),data:z.string(),transactionHash:z.string(),blockNumber:hex,blockHash:z.string(),logIndex:hex,removed:z.boolean().optional()});
const txSchema=z.object({hash:z.string(),from:z.string(),to:z.string().nullable(),value:hex,input:z.string(),nonce:hex,blockNumber:hex,blockHash:z.string(),transactionIndex:hex});
const receiptSchema=z.object({transactionHash:z.string(),blockNumber:hex,blockHash:z.string(),status:hex,gasUsed:hex,effectiveGasPrice:hex,l1Fee:hex.optional(),blobGasUsed:hex.optional(),blobGasPrice:hex.optional(),logs:z.array(logSchema)});
const transferSchema=z.object({hash:z.string(),blockNum:hex,from:z.string(),to:z.string().nullable(),category:z.string(),uniqueId:z.string().optional(),rawContract:z.object({value:z.string().nullable().optional()}).optional()});
const TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const lower=(v:string)=>v.toLowerCase();
const tag=(n:bigint)=>`0x${n.toString(16)}`;
export interface ReplayEvent {record:IndexedTransaction;before:Map<string,Position>;after:Map<string,Position>;fee:Decimal;order:number}

// Official PancakeSwap v2 deployments, reviewed 2026-09-17.
// https://developer.pancakeswap.finance/contracts/v2/addresses
const routers:Partial<Record<Chain,string[]>>={
  ethereum:['0xeff92a263d31888d860bd50809a8d171709b7b1c','0x7a250d5630b4cf539739df2c5dacb4c659f2488d'],
  bnb:['0x10ed43c718714eb63d5aa57b78b54704e256024e'],
  base:['0x8cfe327cec66d1c090dd72bd0ff11d690c33a2eb'],
  robinhood:['0x8cfe327cec66d1c090dd72bd0ff11d690c33a2eb'],
};
const swapAbi=parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)',
  'function swapTokensForExactTokens(uint256 amountOut,uint256 amountInMax,address[] path,address to,uint256 deadline)',
  'function swapExactETHForTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable',
  'function swapETHForExactTokens(uint256 amountOut,address[] path,address to,uint256 deadline) payable',
  'function swapExactTokensForETH(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)',
  'function swapTokensForExactETH(uint256 amountOut,uint256 amountInMax,address[] path,address to,uint256 deadline)',
]);
export function classifyEvm(tx:z.infer<typeof txSchema>,successful:boolean,chain:Chain,wallet:string,before:Map<string,Position>,after:Map<string,Position>,fee:Decimal){
  const delta=new Map([...new Set([...before.keys(),...after.keys()])].map(a=>[a,new Decimal(after.get(a)?.balance??0).minus(before.get(a)?.balance??0).add(a==='native'?fee:0)]).filter(([,v])=>!(v as Decimal).isZero()) as [string,Decimal][]);
  if(!successful){if(delta.size)throw new Error('Failed transaction changed assets beyond its fee');return {classification:'FEE' as const,reason:'Failed transaction fee counted against return'};}
  const owned=lower(tx.from)===wallet;
  if(owned&&tx.to&&routers[chain]?.includes(lower(tx.to))){
    const decoded=decodeFunctionData({abi:swapAbi,data:tx.input as `0x${string}`});
    const args=decoded.args,path=args.find((v:unknown)=>Array.isArray(v)) as readonly string[],recipient=args[args.length-2];
    if(!path||path.length<2||typeof recipient!=='string'||lower(recipient)!==wallet)throw new Error('Swap output must return to the verified wallet');
    const nativeIn=decoded.functionName.startsWith('swapExactETH')||decoded.functionName.startsWith('swapETH');
    const nativeOut=decoded.functionName.endsWith('ForETH')||decoded.functionName.endsWith('ForExactETH');
    const input=nativeIn?'native':lower(path[0]),output=nativeOut?'native':lower(path.at(-1)!);
    if(delta.size!==2||!delta.get(input)?.lt(0)||!delta.get(output)?.gt(0))throw new Error('Swap includes unexplained asset changes');
    if((nativeIn&&lower(path[0])!==lower(CHAINS[chain].native))||(nativeOut&&lower(path.at(-1)!)!==lower(CHAINS[chain].native)))throw new Error('Swap wrapped-native path mismatch');
    if(decoded.functionName.startsWith('swapExactTokens')&&!delta.get(input)!.negated().mul(new Decimal(10).pow(before.get(input)!.decimals)).eq(String(args[0])))throw new Error('Swap input amount does not reconcile');
    return {classification:'SWAP' as const,reason:'Known router, decoded swap, owned recipient, exact asset deltas and receipt verified'};
  }
  if(tx.input==='0x'||tx.input===''||tx.input.startsWith('0xa9059cbb')&&tx.input.length===138){
    if(tx.input.startsWith('0xa9059cbb')){
      const asset=lower(tx.to??''),amount=BigInt(`0x${tx.input.slice(74)}`),recipient=lower(`0x${tx.input.slice(34,74)}`);
      if(!owned&&recipient!==wallet)throw new Error('Indirect token transfer needs protocol evidence');
      const expected=new Decimal(amount.toString()).div(new Decimal(10).pow(before.get(asset)?.decimals??after.get(asset)?.decimals??18)).mul(owned?(recipient===wallet?0:-1):1);
      if([...delta].some(([a,v])=>a!==asset||!v.eq(expected))||!expected.isZero()&&!delta.has(asset))throw new Error('Token transfer includes unexplained changes');
    }
    return {classification:'TRANSFER' as const,reason:'Plain wallet transfer with receipt and exact balance replay'};
  }
  if(owned&&tx.input.startsWith('0x095ea7b3')&&tx.input.length===138&&!delta.size&&BigInt(tx.value)===0n)return {classification:'FEE' as const,reason:'Token approval fee counted against return'};
  throw new Error('Unsupported contract call or bridge: protocol evidence needs review');
}

export async function replayEvm(rpc:Rpc,walletInput:string,previous:Snapshot,current:Snapshot,duelId:string,profileId:string):Promise<{events:ReplayEvent[];transactions:IndexedTransaction[];issues:string[]}>{
  const wallet=lower(walletInput),chain=rpc.chain,events:ReplayEvent[]=[],transactions:IndexedTransaction[]=[],issues:string[]=[];
  try{
    const from=BigInt(previous.block),to=BigInt(current.block);
    if(to<from)throw new Error('Block sequence moved backwards');
    if(to===from){if(previous.blockHash!==current.blockHash)throw new Error('Block hash changed');return {events,transactions,issues};}
    const [startCode,endCode,startNonce,endNonce]=await Promise.all([
      rpc.call<string>('eth_getCode',[wallet,previous.block]),rpc.call<string>('eth_getCode',[wallet,current.block]),
      rpc.call<string>('eth_getTransactionCount',[wallet,previous.block]),rpc.call<string>('eth_getTransactionCount',[wallet,current.block]),
    ]);
    if(startCode!=='0x'||endCode!=='0x')throw new Error('Smart or delegated wallets require a dedicated transaction decoder');
    const n0=BigInt(startNonce),n1=BigInt(endNonce);if(n1<n0||n1-n0>40n)throw new Error('Wallet activity exceeds the bounded replay limit');
    const hashes=new Set<string>();
    // Nonce bisection finds approvals and failed transactions missing from transfer indexes.
    async function outbound(lo:bigint,hi:bigint,before:bigint,after:bigint):Promise<void>{
      if(before===after)return;
      if(hi-lo===1n){
        const block=z.object({transactions:z.array(txSchema)}).parse(await rpc.call('eth_getBlockByNumber',[tag(hi),true]));
        const own=block.transactions.filter(t=>lower(t.from)===wallet);if(BigInt(own.length)!==after-before)throw new Error('Outgoing nonce coverage is incomplete');
        for(const tx of own)hashes.add(tx.hash);return;
      }
      const mid=(lo+hi)/2n,count=BigInt(await rpc.call<string>('eth_getTransactionCount',[wallet,tag(mid)]));
      await outbound(lo,mid,before,count);await outbound(mid,hi,count,after);
    }
    await outbound(from,to,n0,n1);
    const topic=`0x${wallet.slice(2).padStart(64,'0')}`,logs=new Map<string,z.infer<typeof logSchema>>();
    async function readLogs(lo:bigint,hi:bigint,topics:(string|null)[]):Promise<void>{
      try{
        const entries=z.array(logSchema).parse(await rpc.call('eth_getLogs',[{fromBlock:tag(lo),toBlock:tag(hi),topics}]));
        if(entries.length>=1000)throw new Error('Log response may be truncated');
        for(const log of entries){if(log.removed)throw new Error('Removed log in block evidence');if(log.topics.length!==3)continue;hashes.add(log.transactionHash);logs.set(`${log.transactionHash}:${log.logIndex}`,log);}
      }catch(error){if(lo===hi)throw error;const mid=(lo+hi)/2n;await readLogs(lo,mid,topics);await readLogs(mid+1n,hi,topics);}
    }
    if(to-from>4000n)throw new Error('Indexing interval exceeds the free replay window');
    for(let lo=from+1n;lo<=to;lo+=500n){const hi=lo+499n<to?lo+499n:to;await readLogs(lo,hi,[TRANSFER,topic]);await readLogs(lo,hi,[TRANSFER,null,topic]);}
    let transfers:z.infer<typeof transferSchema>[]=[];
    try{transfers=z.array(transferSchema).parse(await rpc.getTokenTransfers(wallet,tag(from+1n),current.block));for(const t of transfers)if(BigInt(t.blockNum)>from&&BigInt(t.blockNum)<=to)hashes.add(t.hash);}catch{/* Exact end-balance and nonce reconciliation below still required. */}
    if(hashes.size>80)throw new Error('Transaction count exceeds the free replay limit');
    const txs:z.infer<typeof txSchema>[]=[];
    for(const hash of hashes){const tx=txSchema.parse(await rpc.getTransaction(hash));if(tx.hash!==hash||BigInt(tx.blockNumber)<=from||BigInt(tx.blockNumber)>to)throw new Error('Transaction outside requested evidence range');txs.push(tx);}
    txs.sort((a,b)=>Number(BigInt(a.blockNumber)-BigInt(b.blockNumber))||Number(BigInt(a.transactionIndex)-BigInt(b.transactionIndex)));
    let running=new Map(previous.positions.map(p=>[lower(p.address),{...p,address:lower(p.address)}]));
    for(const tx of txs){
      const receipt=receiptSchema.parse(await rpc.getReceipt(tx.hash));
      const block=z.object({hash:z.string(),timestamp:hex}).parse(await rpc.getBlock(tx.blockNumber));
      if(receipt.transactionHash!==tx.hash||receipt.blockHash!==tx.blockHash||block.hash!==tx.blockHash||receipt.blockNumber!==tx.blockNumber)throw new Error('Receipt or canonical block mismatch');
      const record:IndexedTransaction={id:`${duelId}:${profileId}:${chain}:${tx.hash}`,duelId,wallet:profileId,chain,hash:tx.hash,block:tx.blockNumber,blockHash:tx.blockHash,timestamp:Number(BigInt(block.timestamp))*1000,classification:'CLASSIFICATION_PENDING',reason:'Awaiting complete evidence'};transactions.push(record);
      const before=running,after=new Map([...before].map(([k,v])=>[k,{...v}]));
      async function change(asset:string,raw:bigint,decimals?:number){
        asset=lower(asset);let position=after.get(asset);
        if(!position){const d=decimals??Number(BigInt(await rpc.call<string>('eth_call',[{to:asset,data:'0x313ce567'},tx.blockNumber])));if(d>36)throw new Error('Unsupported token precision');position={address:asset,symbol:asset.slice(0,6),balance:'0',rawBalance:'0',decimals:d,price:null,valueUsd:'0',excludedUsd:'0'};}
        const amount=BigInt(position.rawBalance)+raw;if(amount<0n)throw new Error('Asset replay gap');
        after.set(asset,{...position,rawBalance:String(amount),balance:new Decimal(String(amount)).div(new Decimal(10).pow(position.decimals)).toString()});
      }
      const own=lower(tx.from)===wallet,success=BigInt(receipt.status)===1n;
      if(success&&own&&tx.input==='0x'&&tx.to&&BigInt(tx.value)>0n&&await rpc.call<string>('eth_getCode',[tx.to,tx.blockNumber])!=='0x')throw new Error('Native transfer invokes a contract; protocol evidence needs review');
      // Base/Robinhood L1 data fees are separate from EVM execution gas.
      if(own&&(chain==='base'||chain==='robinhood')&&receipt.l1Fee===undefined)throw new Error('L1 data fee missing from rollup receipt');
      const feeRaw=own?BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice)+BigInt(receipt.l1Fee??'0x0')+BigInt(receipt.blobGasUsed??'0x0')*BigInt(receipt.blobGasPrice??'0x0'):0n;
      await change('native',-feeRaw,18);
      if(success){
        if(own)await change('native',-BigInt(tx.value),18);if(lower(tx.to??'')===wallet)await change('native',BigInt(tx.value),18);
        const internal=new Map<string,z.infer<typeof transferSchema>>();
        for(const t of transfers.filter(t=>t.hash===tx.hash&&t.category==='internal')){if(!t.uniqueId||!t.rawContract?.value)throw new Error('Exact internal transfer value or identity missing');internal.set(t.uniqueId,t);}
        for(const t of internal.values()){if(lower(t.from)===wallet)throw new Error('Unexpected native internal debit from an ordinary wallet');if(lower(t.to??'')===wallet)await change('native',BigInt(t.rawContract!.value!),18);}
        for(const log of receipt.logs){
          if(log.topics[0]!==TRANSFER||log.topics.length!==3)continue;
          const source=lower(`0x${log.topics[1].slice(-40)}`),dest=lower(`0x${log.topics[2].slice(-40)}`);if(source!==wallet&&dest!==wallet)continue;
          if(!logs.has(`${tx.hash}:${log.logIndex}`))throw new Error('Transfer receipt missing from the incremental log index');
          let asset=lower(log.address),raw=BigInt(log.data);
          if(chain==='arc'&&asset===lower(CHAINS.arc.native)){
            // Arc's USDC interface shares native balances. Native value is already
            // applied for top-level transfers; ERC-20 calls use six-decimal logs.
            if(BigInt(tx.value)!==0n)continue;asset='native';raw*=1000000000000n;
          }
          if(source===wallet)await change(asset,-raw,asset==='native'?18:undefined);if(dest===wallet)await change(asset,raw,asset==='native'?18:undefined);
        }
      }
      const fee=new Decimal(String(feeRaw)).div('1e18');
      try{Object.assign(record,classifyEvm(tx,success,chain,wallet,before,after,fee));}catch(error){record.reason=error instanceof Error?error.message:'Unsupported transaction';issues.push(record.reason);}
      events.push({record,before,after,fee,order:Number(BigInt(tx.transactionIndex))});running=after;
    }
    const assets=new Set([...running.keys(),...current.positions.map(p=>lower(p.address))]);
    if([...assets].some(a=>!new Decimal(running.get(a)?.rawBalance??0).eq(current.positions.find(p=>lower(p.address)===a)?.rawBalance??0)))throw new Error('Transaction replay does not reconcile to pinned end balances; native transfer or token evidence is missing');
  }catch(error){issues.push(error instanceof Error?error.message:'EVM reconciliation unavailable');}
  return {events,transactions,issues:[...new Set(issues)]};
}
