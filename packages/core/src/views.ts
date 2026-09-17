import type { Duel, DuelView, State, Stats } from './types.js';
export function statsFor(state: State, profileId: string): Stats {
  const duels = state.duels.filter(d=>d.visibility==='PUBLIC' && d.status==='COMPLETED' && (d.challenger===profileId || d.opponent===profileId)).sort((a,b)=>(a.endsAt ?? 0)-(b.endsAt ?? 0));
  let wins=0, losses=0, ties=0, streak=0, longestStreak=0, sum=0, won=0, staked=0; const returns: number[]=[];
  for(const d of duels){ const ret=(d.challenger===profileId?d.challengerReturn:d.opponentReturn)??0; returns.push(ret); sum+=ret; staked+=Number(d.stake); if(d.winner===profileId){wins++;streak=streak<0?1:streak+1;won+=Number(d.stake);longestStreak=Math.max(longestStreak,streak);}else if(d.winner===null){ties++;streak=0;}else{losses++;streak=streak>0?-1:streak-1;won-=Number(d.stake);} }
  return {wins,losses,ties,total:duels.length,winRate:duels.length?wins/duels.length*100:0,averageReturn:duels.length?sum/duels.length:0,bestReturn:returns.length?Math.max(...returns):0,worstReturn:returns.length?Math.min(...returns):0,streak,longestStreak,won,staked};
}
export function duelView(state: State, d: Duel): DuelView {
  const predictions=state.predictions.filter(p=>p.duelId===d.id); const backing: [number,number]=[0,0]; predictions.forEach(p=>{backing[p.side===d.challenger?0:1]+=p.points;});
  return {...d,challengerProfile:state.profiles.find(p=>p.id===d.challenger)!,opponentProfile:state.profiles.find(p=>p.id===d.opponent)!,challengerStats:statsFor(state,d.challenger),opponentStats:statsFor(state,d.opponent),backing,predictionCount:predictions.length};
}
export const pointsFor=(state:State, profileId:string)=>state.ledger.filter(l=>l.profileId===profileId).reduce((s,l)=>s+l.delta,0);
export function settlePredictions(state: State, duel: Duel, now=Date.now()) {
  if(duel.predictionSettled) return;
  const all=state.predictions.filter(p=>p.duelId===duel.id); const winners=all.filter(p=>p.side===duel.winner); const pool=all.reduce((s,p)=>s+p.points,0); const winPool=winners.reduce((s,p)=>s+p.points,0);
  let paid=0;
  for(const p of all){p.payout=duel.winner===null||duel.status==='CANCELLED'||winPool===0?p.points:p.side===duel.winner?Math.floor(pool*p.points/winPool):0;paid+=p.payout;}
  // Deterministic integer remainder; the points ledger conserves the whole pool.
  if(winPool && duel.winner!==null && duel.status!=='CANCELLED') for(const p of [...winners].sort((a,b)=>a.id.localeCompare(b.id))){if(paid>=pool)break;p.payout!++;paid++;}
  for(const p of all) if(p.payout) state.ledger.push({id:`payout-${p.id}`,profileId:p.profileId,delta:p.payout,reason:'Prediction settled',duelId:duel.id,createdAt:now});
  duel.predictionSettled=true;
}
