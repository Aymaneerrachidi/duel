import Decimal from 'decimal.js';
import { z } from 'zod';
import { CHAINS, RULES, type Chain } from '../../../packages/core/src/config.js';
import { valuePosition } from '../../../packages/core/src/pnl.js';
import { combineSnapshots, portfolioAddress } from '../../../packages/core/src/portfolio.js';
import type { CashFlow, Duel, IndexedTransaction, Price, Profile, Snapshot } from '../../../packages/core/src/types.js';
import type { Repository } from './repository.js';
import { Rpc } from './providers/rpc.js';
import { Prices, tokenKey } from './providers/prices.js';
import type { Priority, Transport } from './providers/transport.js';
import { replaySolana } from './solana-replay.js';
import { verifyFinality } from './finality.js';
import { replayEvm, type ReplayEvent } from './evm-replay.js';
export class Analytics {
  constructor(private rpcFor:(chain:Chain)=>Rpc,private prices:Prices,private repo:Repository,private http:Transport){}
  finality(snapshots:Snapshot[],transactions:IndexedTransaction[],cached:Duel['finalityProofs']=[]){return verifyFinality(this.rpcFor,snapshots,transactions,cached);}
  async snapshot(duel:Duel,profile:Profile,priority:Priority='live'):Promise<Snapshot>{
    if(duel.chains){
      const components:Snapshot[]=[];
      // Each provider still shares one quota. Bound upstream concurrency while
      // retaining a visible failed component instead of silently dropping a chain.
      for(const chain of duel.chains){
        const wallet=portfolioAddress(duel,profile,chain);
        try{
          if(!wallet)throw new Error(`Link your ${chain==='solana'?'Solana':'EVM'} wallet to include this chain`);
          components.push(await this.snapshot({...duel,chain,chains:undefined},{...profile,wallet},priority));
        }catch{
          components.push({id:crypto.randomUUID(),duelId:duel.id,wallet:profile.id,chain,timestamp:Date.now(),block:'unavailable',totalUsd:'0',positions:[],quality:'INCOMPLETE',issues:[wallet?'Finalized balances or pricing are unavailable; this chain is not fully valued':`Link your ${chain==='solana'?'Solana':'EVM'} wallet to include this chain`],rulesVersion:duel.rulesVersion,transactionCoverage:false});
        }
      }
      return combineSnapshots(duel,profile,components);
    }
    const balances=await this.rpcFor(duel.chain).balances(profile.wallet,priority,'latest');
    // Native currency and its wrapped token are separate accounting assets.
    const tokens=new Map<string,typeof balances.native>([['native',{...balances.native,address:'native'}]]);
    for(const b of balances.tokens){
      // Arc's ERC-20 USDC interface shares its native balance (6 versus 18 decimals).
      if(duel.chain==='arc'&&tokenKey('arc',b.address)===tokenKey('arc',CHAINS.arc.native))continue;
      const key=tokenKey(duel.chain,b.address),prior=tokens.get(key);tokens.set(key,prior?{...b,balance:new Decimal(prior.balance).add(b.balance).toString(),raw:new Decimal(prior.raw).add(b.raw).toString()}:b);
    }
    const quotes=await this.prices.getTokenPrices(duel.chain,[...tokens.keys()].filter(k=>k!=='native'),priority);
    const nativePrice=await this.prices.getNativePrice(duel.chain);if(nativePrice)quotes.set('native',nativePrice);
    // Capture recent blocks and their hashes; the final result waits for canonical finality.
    const timestamp=balances.timestamp;
    const history=(await this.repo.read()).prices;
    for(const [key,quote] of quotes){
      const rows=history.filter(p=>p.chain===(quote.referenceChain??quote.chain)&&tokenKey(p.chain,p.address)===tokenKey(quote.referenceChain??quote.chain,quote.referenceAddress??quote.address));
      const past=rows.flatMap(p=>[p,...p.history??[]]).filter(p=>p.timestamp<=timestamp&&timestamp-p.timestamp<=RULES.maxPriceAgeSeconds*1000).sort((a,b)=>b.timestamp-a.timestamp)[0];
      if(past&&quote.timestamp>timestamp)quotes.set(key,{...past,chain:quote.chain,address:quote.address,referenceChain:quote.referenceChain,referenceAddress:quote.referenceAddress});
    }
    const positions=[...tokens.entries()].map(([key,b])=>valuePosition({address:b.address,symbol:quotes.get(key)?.symbol??b.symbol,balance:b.balance,rawBalance:b.raw,decimals:b.decimals,price:quotes.get(key)??null},timestamp));
    const issues=[...balances.issues];
    if(Date.now()-timestamp>RULES.endToleranceSeconds*1000)issues.push('Block is outside the price observation window');
    if(positions.some(p=>!p.price&&new Decimal(p.balance).gt(0)))issues.push('One or more nonzero assets have no reference price');
    if(positions.some(p=>p.reason?.includes('outside')||p.reason?.includes('disagreement')))issues.push('Stale or conflicting market data');
    if(positions.some(p=>p.price?.pool==='provider-aggregate'))issues.push('Aggregate fallback price is available, but individual pool liquidity proof is missing');
    return {id:crypto.randomUUID(),duelId:duel.id,wallet:profile.id,chain:duel.chain,timestamp,block:balances.block,blockHash:balances.blockHash,finality:duel.chain==='solana'?'finalized':'pending',tokenAccounts:balances.tokens.map(t=>t.account).filter((a):a is string=>!!a),totalUsd:positions.reduce((a,p)=>a.add(p.valueUsd),new Decimal(0)).toString(),positions,quality:issues.length?'INCOMPLETE':positions.some(p=>p.reason||p.price?.confidence!=='HIGH')?'MEDIUM':'HIGH',issues,rulesVersion:duel.rulesVersion,transactionCoverage:!duel.startsAt};
  }
  private async historicalPrice(chain:Chain,address:string,timestamp:number):Promise<Price|null>{
    const state=await this.repo.read();
    const all=[...state.snapshots.flatMap(s=>s.positions.map(p=>p.price)).filter((p):p is Price=>!!p),...state.prices.flatMap(p=>[p,...p.history??[]])];
    const referenceChain=chain==='arc'||chain==='robinhood'?'ethereum':chain;
    const referenceAddress=chain==='arc'&&address===CHAINS.arc.native?'0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48':chain==='robinhood'&&address===CHAINS.robinhood.native?CHAINS.ethereum.native:address;
    const matching=all.filter(p=>(p.chain===chain&&tokenKey(chain,p.address)===tokenKey(chain,address)||p.chain===referenceChain&&tokenKey(referenceChain,p.address)===tokenKey(referenceChain,referenceAddress))&&p.timestamp<=timestamp).sort((a,b)=>b.timestamp-a.timestamp);
    const cached=matching.find(p=>timestamp-p.timestamp<=RULES.maxPriceAgeSeconds*1000);if(cached)return {...cached,chain,address};
    const reference=matching[0];if(!reference||timestamp-reference.timestamp>600000)return null;
    const network=referenceChain==='bnb'?'bsc':referenceChain;const id=`${network}:${referenceAddress}`;
    try{const raw=await this.http.json<unknown>('defillama',`https://coins.llama.fi/prices/historical/${Math.floor(timestamp/1000)}/${id}?searchWidth=2m`,{ttl:86400000,priority:'essential'});
      const parsed=z.object({coins:z.record(z.string(),z.object({price:z.number().nonnegative(),timestamp:z.number(),confidence:z.number().optional()}))}).parse(raw);const p=parsed.coins[id];if(!p||p.timestamp*1000>timestamp||timestamp-p.timestamp*1000>120000||(p.confidence??0)<0.9)return null;
      return {...reference,chain,address,usd:String(p.price),source:'DefiLlama historical + recorded liquidity',timestamp:p.timestamp*1000,observedAt:Date.now(),confidence:'MEDIUM'};
    }catch{return null;}
  }

  async valueTransfers(duel:Duel,profile:Profile,previous:Snapshot,current:Snapshot,events:ReplayEvent[]){
    const flows:CashFlow[]=[],issues:string[]=[];
    const running=new Map((previous.components??[previous]).map(s=>[s.chain,new Map(s.positions.map(p=>[tokenKey(s.chain,p.address),p]))]));
    const ordered=[...events].sort((a,b)=>a.record.timestamp-b.record.timestamp||(a.record.chain===b.record.chain?Number(BigInt(a.record.block)-BigInt(b.record.block))||a.order-b.order:a.record.chain.localeCompare(b.record.chain)));
    for(const event of ordered){
      const {record}=event,chain=record.chain,timestamp=record.timestamp;
      try{
        const beforeChain=running.get(chain);if(!beforeChain)throw new Error('Missing chain at transfer boundary');
        if(record.classification==='TRANSFER'){
          if((previous.components??[previous]).some(s=>s.timestamp>timestamp)||(current.components??[current]).some(s=>s.timestamp<timestamp))throw new Error('Transfer overlaps asynchronous portfolio boundaries');
          if(ordered.some(other=>other!==event&&other.record.chain!==chain&&other.record.timestamp===timestamp))throw new Error('Cross-chain transactions share a timestamp; ordering needs review');
          let beforeUsd=new Decimal(0),afterUsd=new Decimal(0);
          for(const [assetChain,positions] of running){
            const after=assetChain===chain?event.after:positions;
            for(const address of new Set([...positions.keys(),...after.keys()])){
              const p=positions.get(address),q=after.get(address),template=(p??q)!;
              const beforeBalance=new Decimal(p?.balance??0).minus(assetChain===chain&&address==='native'?event.fee:0),afterBalance=new Decimal(q?.balance??0);
              if(beforeBalance.isZero()&&afterBalance.isZero())continue;
              const quote=await this.historicalPrice(assetChain,address==='native'?CHAINS[assetChain].native:address,timestamp);
              if(!quote)throw new Error('Point-in-time price or liquidity missing at whole-portfolio transfer boundary');
              beforeUsd=beforeUsd.add(valuePosition({...template,balance:beforeBalance.toString(),price:quote},timestamp).valueUsd);
              afterUsd=afterUsd.add(valuePosition({...template,balance:afterBalance.toString(),price:quote},timestamp).valueUsd);
            }
          }
          const delta=afterUsd.minus(beforeUsd);
          flows.push({id:record.id,duelId:duel.id,wallet:profile.id,txHash:record.hash,timestamp,amountUsd:delta.toString(),beforeValueUsd:beforeUsd.toString(),afterValueUsd:afterUsd.toString(),classification:delta.gte(0)?'INFLOW':'OUTFLOW',reason:'Chronological whole-portfolio transfer valuation; transaction fees count against return'});
        }
      }catch(error){issues.push(error instanceof Error?error.message:'Transfer valuation failed');}
      running.set(chain,event.after);
    }
    return {flows,issues};
  }

  async reconcile(duel:Duel,profile:Profile,previous:Snapshot,current:Snapshot,valueFlows=true):Promise<{flows:CashFlow[];transactions:IndexedTransaction[];issues:string[];events?:ReplayEvent[]}>{
    if(duel.chains){
      const flows:CashFlow[]=[],transactions:IndexedTransaction[]=[],issues:string[]=[],events:ReplayEvent[]=[];
      for(const chain of duel.chains){
        const before=previous.components?.find(s=>s.chain===chain),after=current.components?.find(s=>s.chain===chain),wallet=portfolioAddress(duel,profile,chain);
        if(!before||!after||!wallet||before.block==='unavailable'||after.block==='unavailable'){issues.push(`${CHAINS[chain].name}: chain evidence or locked wallet missing`);continue;}
        const part=await this.reconcile({...duel,chain,chains:undefined},{...profile,wallet},before,after,false);
        after.transactionCoverage=!part.issues.length;after.issues.push(...part.issues);if(part.issues.length)after.quality='INCOMPLETE';
        issues.push(...part.issues.map(i=>`${CHAINS[chain].name}: ${i}`));
        transactions.push(...part.transactions.map(tx=>({...tx,id:`${duel.id}:${profile.id}:${chain}:${tx.hash}`})));
        events.push(...part.events??[]);
        if(part.flows.length&&!part.events?.length){
          for(const flow of part.flows)flows.push({...flow,classification:'CLASSIFICATION_PENDING',reason:'Synchronized whole-portfolio evidence missing'});
          issues.push('Transfers require synchronized whole-portfolio valuations');
        }
      }
      const valued=await this.valueTransfers(duel,profile,previous,current,events);flows.push(...valued.flows);issues.push(...valued.issues);
      return {flows,transactions,events,issues:[...new Set(issues)]};
    }
    const rpc=this.rpcFor(duel.chain),issues:string[]=[],transactions:IndexedTransaction[]=[],flows:CashFlow[]=[];
    if(duel.chain!=='solana'){
      const replay=await replayEvm(rpc,profile.wallet,previous,current,duel.id,profile.id);
      const valued=valueFlows?await this.valueTransfers(duel,profile,previous,current,replay.events):{flows:[],issues:[]};
      return {...replay,flows:valued.flows,issues:[...replay.issues,...valued.issues]};
    }
    const events:ReplayEvent[]=[];
    try{
      const addresses=[...new Set([profile.wallet,...previous.tokenAccounts??[],...current.tokenAccounts??[]])];
      if(addresses.length>25)throw new Error('Wallet exceeds the beta transaction-indexing account limit');
      const signatures=new Map<string,{slot:number;signature:string}>();
      for(const address of addresses)for(const entry of await rpc.getRecentSignatures(address,0,Number(previous.block)))if(entry.slot<=Number(current.block))signatures.set(entry.signature,entry);
      const ordered=[...signatures.values()].sort((a,b)=>a.slot-b.slot);
      const orders=new Map<number,string[]>();
      for(const slot of new Set(ordered.filter(e=>ordered.filter(t=>t.slot===e.slot).length>1).map(e=>e.slot)))orders.set(slot,await rpc.signatureOrder(slot));
      ordered.sort((a,b)=>a.slot-b.slot||(orders.get(a.slot)?.indexOf(a.signature)??0)-(orders.get(b.slot)?.indexOf(b.signature)??0));
      let running=new Map(previous.positions.map(p=>[p.address,{...p}]));
      for(const entry of ordered){
        const record:IndexedTransaction={id:`${duel.id}:${profile.id}:${entry.signature}`,duelId:duel.id,wallet:profile.id,chain:'solana',hash:entry.signature,timestamp:current.timestamp,block:String(entry.slot),classification:'CLASSIFICATION_PENDING',reason:'Awaiting complete transaction evidence'};transactions.push(record);
        try{
          if(orders.has(entry.slot)&&!orders.get(entry.slot)!.includes(entry.signature))throw new Error('Signature missing from finalized block order');
          const replay=replaySolana(await rpc.getTransaction(entry.signature),profile.wallet,running),timestamp=replay.tx.blockTime!*1000;
          if(replay.tx.slot!==entry.slot)throw new Error('Transaction slot mismatch');
          record.timestamp=timestamp;
          events.push({record,before:running,after:replay.after,fee:replay.fee,order:orders.get(entry.slot)?.indexOf(entry.signature)??0});
          record.classification=replay.classification;record.reason=replay.reason;running=replay.after;
        }catch(error){record.reason=error instanceof Error?error.message:'Transaction reconciliation failed';issues.push(record.reason);}
      }
      const assets=new Set([...running.keys(),...current.positions.map(p=>p.address)]);
      if([...assets].some(a=>!new Decimal(running.get(a)?.rawBalance??0).eq(current.positions.find(p=>p.address===a)?.rawBalance??0)))issues.push('Transaction replay does not reconcile to current balances');
    }catch(error){issues.push(error instanceof Error?error.message:'Incremental Solana reconciliation incomplete');}
    const valued=valueFlows?await this.valueTransfers(duel,profile,previous,current,events):{flows:[],issues:[]};flows.push(...valued.flows);issues.push(...valued.issues);
    return {flows,transactions,events,issues:[...new Set(issues)]};
  }
}
