import { z } from 'zod';
import bs58 from 'bs58';
import { isAddress } from 'viem';
import { CHAINS, CHAIN_IDS, RULES, enabledChains, isDemo, type Chain, type Env } from '../../../packages/core/src/config.js';
import { calculateDuelResult, timeWeightedReturn, transition } from '../../../packages/core/src/pnl.js';
import { demoSnapshot } from '../../../packages/core/src/demo.js';
import { settlePredictions } from '../../../packages/core/src/views.js';
import { linkedWallets, ownsAddress, PORTFOLIO_RULES_VERSION, walletFamily, walletKey } from '../../../packages/core/src/portfolio.js';
import type { Duel, Profile, Snapshot, State } from '../../../packages/core/src/types.js';
import type { Repository } from './repository.js';
import type { Analytics } from './analytics.js';
function hasFutureQuote(snapshot:Snapshot){return (snapshot.components??[snapshot]).some(s=>s.positions.some(p=>Number(p.balance)>0&&p.price&&p.price.timestamp>s.timestamp));}
export class AppError extends Error { constructor(message:string,readonly status=400){super(message);this.name='AppError';} }
export function normalizeWallet(chain:Chain,wallet:string){if(chain==='solana'){try{if(bs58.decode(wallet).length!==32)throw new Error();return wallet;}catch{throw new AppError('Enter a valid Solana wallet address.');}}if(!isAddress(wallet))throw new AppError('Enter a valid EVM wallet address.');return wallet.toLowerCase();}
export const createSchema=z.object({chain:z.enum(CHAIN_IDS).optional(),opponent:z.string().min(3).max(100),stake:z.string().regex(/^(?:0|[1-9]\d{0,6})(?:\.\d{1,9})?$/).refine(v=>Number(v)>0&&Number(v)<=100000),duration:z.union([z.literal(86400000),z.literal(259200000),z.literal(604800000)]),visibility:z.enum(['PUBLIC','UNLISTED']).default('PUBLIC')});
export function addEvent(s:State,duel:Duel,type:string,text:string,now=Date.now()){s.events.push({id:crypto.randomUUID(),duelId:duel.id,type,text,createdAt:now});}
export function ensureProfile(s:State,chain:Chain,wallet:string,demo=false){let p=s.profiles.find(p=>p.demo===demo&&ownsAddress(p,chain,wallet));if(!p){p={id:crypto.randomUUID(),wallet,chain,wallets:[],username:'',createdAt:Date.now(),following:[],demo};s.profiles.push(p);s.ledger.push({id:`grant-${p.id}`,profileId:p.id,delta:RULES.initialPoints,reason:'Starting duel points',createdAt:Date.now()});}return p;}
export function linkVerifiedWallet(s:State,profile:Profile,chain:Chain,address:string){
  if(s.profiles.some(p=>p.id!==profile.id&&ownsAddress(p,chain,address)))throw new AppError('This wallet belongs to another trader account. Sign in with that account instead.',409);
  const family=walletFamily(chain),wallets=linkedWallets(profile),existing=wallets.find(w=>w.family===family);
  if(existing&&walletKey(family,existing.address)!==walletKey(family,address))throw new AppError('This account already has a wallet of this type. Wallet replacement is not supported.',409);
  if(!existing)profile.wallets=[...wallets,{family,address,verifiedAt:Date.now()}];
  return profile;
}
export class DuelService {
  constructor(readonly repo:Repository,private env:Env,private analytics:Analytics){}
  async create(profileId:string,input:z.infer<typeof createSchema>,idempotency:string){return this.repo.transact(s=>{
    const existing=s.controls.find(c=>c.id===`create:${profileId}:${idempotency}`);if(existing){const data=JSON.parse(existing.value) as {request:string;duelId:string};if(data.request!==JSON.stringify(input))throw new AppError('Idempotency key was already used for different parameters.',409);return s.duels.find(d=>d.id===data.duelId)!;}
    if(s.controls.find(c=>c.id==='paused')?.value==='true')throw new AppError('New duels are temporarily paused.',503);
    const self=s.profiles.find(p=>p.id===profileId);if(!self)throw new AppError('Connect your wallet.',401);
    const combined=!isDemo(this.env)||!input.chain,chain=input.chain??self.chain,chains=enabledChains(this.env);
    if(!chains.length)throw new AppError('No trading networks are enabled.',503);
    if(!combined&&!chains.includes(chain))throw new AppError('This chain is disabled.');
    if(!combined&&self.chain!==chain)throw new AppError(`Connect a ${CHAINS[chain].name} account before creating this challenge.`);
    if(combined&&!self.demo&&!['solana','evm'].every(f=>linkedWallets(self).some(w=>w.family===f)))throw new AppError('Link your Solana and EVM wallets before creating a combined portfolio duel.');
    if(s.duels.filter(d=>d.challenger===profileId&&d.createdAt>Date.now()-3600000).length>=5)throw new AppError('You can create five challenges per hour.',429);
    if(s.duels.filter(d=>['OPEN','AWAITING_DEPOSIT','ACTIVE','CALCULATING'].includes(d.status)).length>=Number(this.env.MAX_ACTIVE_DUELS??'10'))throw new AppError('The free beta is at capacity. Try after a duel finishes.',429);
    let opponent:Profile|undefined;
    if(input.opponent.startsWith('@'))opponent=s.profiles.find(p=>p.username===input.opponent.slice(1).toLowerCase()&&(combined||p.chain===chain));
    else {const addressChain=combined?(input.opponent.startsWith('0x')?'ethereum':'solana'):chain;const wallet=normalizeWallet(addressChain,input.opponent);opponent=ensureProfile(s,addressChain,wallet,isDemo(this.env));}
    if(!opponent)throw new AppError('No trader with that username exists.');if(opponent.id===self.id)throw new AppError('Choose another trader to challenge.');
    const now=Date.now();const d:Duel={id:crypto.randomUUID(),slug:crypto.randomUUID().replaceAll('-','').slice(0,9).toUpperCase(),chain:combined?'solana':chain,...(combined?{chains}:{}),challenger:self.id,opponent:opponent.id,stake:input.stake,duration:input.duration,createdAt:now,expiresAt:now+RULES.challengeExpirySeconds*1000,status:'OPEN',visibility:input.visibility,rulesVersion:combined?PORTFOLIO_RULES_VERSION:RULES.version,demo:isDemo(this.env),quality:'HIGH',issues:[],views:0,escrowMode:'simulated'};
    s.duels.push(d);s.controls.push({id:`create:${profileId}:${idempotency}`,value:JSON.stringify({request:JSON.stringify(input),duelId:d.id}),expiresAt:now+86400000});addEvent(s,d,'CHALLENGED',`@${self.username||self.wallet.slice(0,6)} called out @${opponent.username||opponent.wallet.slice(0,6)}.`);return d;
  });}
  async accept(id:string,profileId:string){
    const lease=`accept:${id}`,owner=crypto.randomUUID();
    await this.repo.transact(s=>{const d=s.duels.find(d=>d.id===id);if(!d)throw new AppError('Duel not found.',404);if(d.opponent!==profileId)throw new AppError('Only the challenged wallet can accept.',403);if(d.status!=='OPEN')throw new AppError('This challenge is no longer open.',409);if(d.expiresAt<Date.now())throw new AppError('This challenge has expired.',409);const lock=s.controls.find(c=>c.id===lease);if(lock&&lock.expiresAt!>Date.now())throw new AppError('Acceptance is already being processed.',409);s.controls=s.controls.filter(c=>c.id!==lease);s.controls.push({id:lease,value:owner,expiresAt:Date.now()+300000});});
    try{
      const state=await this.repo.read();const d=state.duels.find(d=>d.id===id)!;const participants=[state.profiles.find(p=>p.id===d.challenger)!,state.profiles.find(p=>p.id===d.opponent)!];const now=Date.now();
      if(d.chains){
        if(!d.demo&&participants.some(p=>!['solana','evm'].every(f=>linkedWallets(p).some(w=>w.family===f))))throw new AppError('Both traders must link and verify their Solana and EVM wallets before acceptance.',422);
        d.portfolioWallets=Object.fromEntries(participants.map(p=>[p.id,structuredClone(linkedWallets(p))]));
      }
      let snapshots:Snapshot[]=d.demo?participants.map(p=>demoSnapshot(d,p,now,0)):await Promise.all(participants.map(p=>this.analytics.snapshot(d,p,'essential')));
      // Warm observations can precede the next block without backdating a quote.
      for(let retry=0;!d.demo&&retry<3&&snapshots.some(hasFutureQuote);retry++){await new Promise(r=>setTimeout(r,15000));snapshots=await Promise.all(participants.map(p=>this.analytics.snapshot(d,p,'essential')));}
      if(snapshots.some(s=>s.quality==='INCOMPLETE'||Number(s.totalUsd)<RULES.minimumStartUsd))throw new AppError(`Starting valuation needs complete data and at least $${RULES.minimumStartUsd} of eligible equity: ${[...new Set(snapshots.flatMap(s=>s.issues))].join('; ')||'equity below minimum'}`,422);
      return await this.repo.transact(s=>{const current=s.duels.find(d=>d.id===id)!;if(current.status!=='OPEN'||current.expiresAt<Date.now()||s.controls.find(c=>c.id===lease)?.value!==owner)throw new AppError('Challenge changed during acceptance.',409);
        if(d.portfolioWallets)current.portfolioWallets=d.portfolioWallets;
        transition(current,'AWAITING_DEPOSIT');current.startsAt=Math.max(...snapshots.map(s=>s.timestamp));current.endsAt=current.startsAt+current.duration;current.lastUpdated=current.startsAt;s.snapshots.push(...snapshots);transition(current,'ACTIVE');addEvent(s,current,'STARTED','Challenge accepted. Starting portfolios recorded.');return current;});
    }finally{await this.repo.transact(s=>{s.controls=s.controls.filter(c=>!(c.id===lease&&c.value===owner));});}
  }
  async cancel(id:string,profileId:string){return this.repo.transact(s=>{const d=s.duels.find(d=>d.id===id);if(!d)throw new AppError('Duel not found.',404);if(d.challenger!==profileId&&d.opponent!==profileId)throw new AppError('Only participants can cancel an open challenge.',403);if(d.status==='CANCELLED')return d;if(d.status!=='OPEN')throw new AppError('Only open challenges can be cancelled.',409);transition(d,'CANCELLED');settlePredictions(s,d);addEvent(s,d,'CANCELLED','Challenge declined or cancelled.');return d;});}
  async update(id:string,finishDemo=false){
    const state=await this.repo.read();const duel=state.duels.find(d=>d.id===id);if(!duel)return;if(duel.status==='CALCULATING'||duel.status==='FINALIZING'){await this.finalize(id);return;}if(duel.status!=='ACTIVE')return;
    const now=finishDemo&&duel.demo?duel.endsAt!:Date.now();const finals=now>=duel.endsAt!;
    const next:Snapshot[]=[];const addedFlows:State['cashflows']=[];const addedTransactions:State['transactions']=[];const issues:string[]=[];
    for(const profileId of [duel.challenger,duel.opponent]){
      const p=state.profiles.find(p=>p.id===profileId)!;const history=state.snapshots.filter(s=>s.duelId===id&&s.wallet===profileId).sort((a,b)=>a.timestamp-b.timestamp);const last=history.at(-1)!;
      if(duel.demo){const t=Math.min(1,(now-duel.startsAt!)/duel.duration);const seed=p.username.split('').reduce((a,c)=>a+c.charCodeAt(0),0);const ret=last.returnPct!==undefined&&history.length>2?(last.returnPct+(now-last.timestamp)/duel.duration*(seed%31-8)):(seed%41-12)*t+Math.sin(t*13)*(t*0.9);next.push(demoSnapshot(duel,p,now,ret));}
      else{
        let current=await this.analytics.snapshot(duel,p,finals?'essential':'live');if(hasFutureQuote(current)){await new Promise(r=>setTimeout(r,15000));current=await this.analytics.snapshot(duel,p,finals?'essential':'live');}const reconciliation=await this.analytics.reconcile(duel,p,last,current);current.transactionCoverage=reconciliation.issues.length===0;current.issues.push(...reconciliation.issues);if(!current.transactionCoverage)current.quality='INCOMPLETE';
        if(history[0].positions.some(start=>Number(start.balance)>0&&start.valueUsd==='0'&&current.positions.some(now=>now.address===start.address&&now.chain===start.chain&&Number(now.valueUsd)>0))){current.quality='INCOMPLETE';current.issues.push('An excluded starting asset became eligible; baseline reconciliation is required');}
        addedFlows.push(...reconciliation.flows);addedTransactions.push(...reconciliation.transactions);issues.push(...current.issues);
        try{if(current.quality!=='INCOMPLETE'&&history.every(s=>s.transactionCoverage&&s.quality!=='INCOMPLETE'))current.returnPct=timeWeightedReturn(history[0].totalUsd,current.totalUsd,[...state.cashflows,...addedFlows].filter(f=>f.duelId===id&&f.wallet===profileId));}catch{current.quality='INCOMPLETE';current.issues.push('Unresolved return calculation');}
        next.push(current);
      }
    }
    if(!duel.demo&&next.some(s=>s.quality==='INCOMPLETE')){
      await this.repo.transact(s=>{const d=s.duels.find(d=>d.id===id);if(!d||d.status!=='ACTIVE'||d.lastUpdated!==duel.lastUpdated)return;d.quality='INCOMPLETE';d.issues=[...new Set(next.flatMap(s=>s.issues))];d.lastUpdated=now;
        if(finals&&Date.now()>d.endsAt!+RULES.endToleranceSeconds*1000){transition(d,'DISPUTED');addEvent(s,d,'DISPUTED','Complete ending evidence was unavailable within the settlement window.');}
      });return;
    }
    await this.repo.transact(async s=>{const d=s.duels.find(d=>d.id===id);if(!d||d.status!=='ACTIVE'||d.lastUpdated!==duel.lastUpdated)return;
      s.snapshots.push(...next);for(const f of addedFlows)if(!s.cashflows.some(v=>v.id===f.id))s.cashflows.push(f);for(const tx of addedTransactions)if(!s.transactions.some(v=>v.id===tx.id))s.transactions.push(tx);
      const previousLead=(d.challengerReturn??0)-(d.opponentReturn??0);d.challengerReturn=next[0].returnPct;d.opponentReturn=next[1].returnPct;d.lastUpdated=now;d.issues=[...new Set(issues)];d.quality=next.some(s=>s.quality==='INCOMPLETE')?'INCOMPLETE':next.some(s=>s.quality!=='HIGH')?'MEDIUM':'HIGH';
      const nextLead=(d.challengerReturn??0)-(d.opponentReturn??0);if(Math.sign(previousLead)!==Math.sign(nextLead)&&Math.abs(nextLead)>0.5)addEvent(s,d,'LEAD_CHANGE','The lead changed. There is still time on the clock.',now);
      if(finals){transition(d,'CALCULATING');addEvent(s,d,'CALCULATING','Ending portfolios recorded. Checking transaction evidence and chain finality.',now);}
    });
    if(finals)await this.finalize(id);
    else if(!duel.demo)await this.confirmEvidence(id);
  }
  async confirmEvidence(id:string){
    const state=await this.repo.read(),d=state.duels.find(d=>d.id===id);if(!d||d.demo)return {pending:[] as string[]};
    const checked=await this.analytics.finality(state.snapshots.filter(s=>s.duelId===id),state.transactions.filter(t=>t.duelId===id),d.finalityProofs);
    await this.repo.transact(s=>{const current=s.duels.find(d=>d.id===id);if(current&&['ACTIVE','CALCULATING','FINALIZING'].includes(current.status))current.finalityProofs=checked.proofs;});
    return checked;
  }
  async finalize(id:string){
    const state=await this.repo.read(),d=state.duels.find(d=>d.id===id);if(!d||!['CALCULATING','FINALIZING'].includes(d.status))return;
    try{
      const evidence=state.snapshots.filter(s=>s.duelId===id);
      if(evidence.some(s=>s.quality==='INCOMPLETE'||!s.transactionCoverage))throw new Error('Incomplete valuation or transaction coverage');
      const finality=d.demo?{pending:[]}:await this.confirmEvidence(id);
      if(finality.pending.length){
        if(Date.now()>d.endsAt!+7200000)throw new Error('Chain finality could not be confirmed within two hours');
        await this.repo.transact(s=>{const current=s.duels.find(d=>d.id===id)!;if(current.status==='CALCULATING')transition(current,'FINALIZING');if(current.status==='FINALIZING')current.issues=[`Waiting for canonical finality: ${finality.pending.join(', ')}`];});return;
      }
      await this.repo.transact(async s=>{const current=s.duels.find(d=>d.id===id)!;if(!['CALCULATING','FINALIZING'].includes(current.status))return;const result=await calculateDuelResult(current,s.snapshots,s.cashflows);Object.assign(current,{challengerReturn:result.challengerReturn,opponentReturn:result.opponentReturn,winner:result.winner,resultHash:result.resultHash,issues:[]});if(current.status==='CALCULATING')transition(current,'FINALIZING');transition(current,'COMPLETED');settlePredictions(s,current);addEvent(s,current,'COMPLETED',result.winner?`@${s.profiles.find(p=>p.id===result.winner)?.username||'Trader'} takes the duel.`:'Final result: a tie.');});
    }catch(error){await this.repo.transact(s=>{const current=s.duels.find(d=>d.id===id)!;if(!['CALCULATING','FINALIZING'].includes(current.status))return;transition(current,'DISPUTED');current.quality='INCOMPLETE';current.issues=[error instanceof Error?error.message:'Calculation integrity check failed'];addEvent(s,current,'DISPUTED','Finalization paused: missing or inconsistent evidence.');});}
  }
  async tick(){
    const now=Date.now(),owner=crypto.randomUUID();const acquired=await this.repo.transact(s=>{const lease=s.controls.find(c=>c.id==='scheduler-lease');if(lease&&lease.expiresAt!>now)return false;s.controls=s.controls.filter(c=>c.id!=='scheduler-lease'&&(!c.expiresAt||c.expiresAt>now));s.controls.push({id:'scheduler-lease',value:owner,expiresAt:now+240000});s.nonces=s.nonces.filter(n=>n.expiresAt>now);s.sessions=s.sessions.filter(n=>n.expiresAt>now);for(const d of s.duels.filter(d=>d.status==='OPEN'&&d.expiresAt<now)){transition(d,'CANCELLED');settlePredictions(s,d);addEvent(s,d,'EXPIRED','Challenge expired.');}return true;});if(!acquired)return;
    try{
      const state=await this.repo.read();const due=state.duels.filter(d=>(['CALCULATING','FINALIZING'].includes(d.status)||d.status==='ACTIVE'&&(now-(d.lastUpdated??0)>(d.demo?300000:Number(this.env[`${d.chain==='solana'?'SOLANA':'EVM'}_ACTIVE_REFRESH_SECONDS`]??300)*1000)||now>=d.endsAt!))).sort((a,b)=>a.endsAt!-b.endsAt!);
      // Bounded cron work. One invocation updates at most two live duels; demo work is local.
      for(const d of due.slice(0,isDemo(this.env)?20:2))try{await this.update(d.id);}catch{await this.repo.transact(s=>{const current=s.duels.find(v=>v.id===d.id)!;current.quality='INCOMPLETE';current.issues=['Provider refresh failed; last verified values retained.'];if(current.status==='ACTIVE'&&now>current.endsAt!+RULES.endToleranceSeconds*1000){transition(current,'DISPUTED');addEvent(s,current,'DISPUTED','Ending snapshot was unavailable within the settlement window.');}});}
      await this.repo.transact(s=>{s.controls=s.controls.filter(c=>c.id!=='last-cron');s.controls.push({id:'last-cron',value:String(Date.now())});});
    }finally{await this.repo.transact(s=>{s.controls=s.controls.filter(c=>!(c.id==='scheduler-lease'&&c.value===owner));});}
  }
}
