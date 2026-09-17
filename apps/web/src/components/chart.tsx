import { useId, useMemo, useState } from 'react';
import type { DuelView, Snapshot } from '@shared/types';
import { nameOf, pct } from '../lib/api';
export function PerformanceChart({duel,snapshots,mini=false}:{duel:DuelView;snapshots:Snapshot[];mini?:boolean}){
  const id=useId().replaceAll(':','');const [range,setRange]=useState('ALL');const [hover,setHover]=useState<number|null>(null);
  const series=useMemo(()=>{const end=Math.max(...snapshots.map(s=>s.timestamp));const cutoff=range==='24H'?end-86400000:range==='3D'?end-3*86400000:0;return [duel.challenger,duel.opponent].map(wallet=>snapshots.filter(s=>s.wallet===wallet&&s.returnPct!==undefined&&s.timestamp>=cutoff).sort((a,b)=>a.timestamp-b.timestamp));},[duel,snapshots,range]);
  const all=series.flat();const minX=Math.min(...all.map(s=>s.timestamp)),maxX=Math.max(...all.map(s=>s.timestamp));const values=all.map(s=>s.returnPct??0);const lower=Math.floor(Math.min(0,...values)/10)*10,upper=Math.ceil(Math.max(10,...values)/10)*10;const w=800,h=mini?160:260,pl=mini?0:48,pr=mini?0:16,pb=mini?2:30,pt=mini?4:18;const x=(t:number)=>pl+(t-minX)/(maxX-minX||1)*(w-pl-pr),y=(v:number)=>pt+(upper-v)/(upper-lower||1)*(h-pb-pt);
  const paths=series.map(list=>list.map((s,i)=>`${i?'L':'M'}${x(s.timestamp).toFixed(2)},${y(s.returnPct??0).toFixed(2)}`).join(' '));const selected=hover===null?null:series.map(list=>list.reduce<Snapshot|undefined>((a,b)=>!a||Math.abs(x(b.timestamp)-hover)<Math.abs(x(a.timestamp)-hover)?b:a,undefined));
  if(!all.length)return <div className="chart-empty">Performance starts at 100 when both starting portfolios are recorded.</div>;
  return <div className={`performance-chart ${mini?'mini-chart':''}`}>{!mini&&<div className="chart-toolbar"><div className="chart-legend"><span><i className="legend-a"/>{nameOf(duel.challengerProfile)}</span><span><i className="legend-b"/>{nameOf(duel.opponentProfile)}</span></div><div className="segmented" aria-label="Chart time range">{['24H','3D','ALL'].map(v=><button key={v} className={range===v?'selected':''} onClick={()=>setRange(v)}>{v}</button>)}</div></div>}
    <div className="chart-canvas"><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Cash-flow-adjusted return chart, normalized to 100 at start" onMouseMove={e=>{const r=e.currentTarget.getBoundingClientRect();setHover((e.clientX-r.left)/r.width*w);}} onMouseLeave={()=>setHover(null)}>
      <defs><linearGradient id={`area${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b5f567" stopOpacity=".1"/><stop offset="100%" stopColor="#b5f567" stopOpacity="0"/></linearGradient></defs>
      {!mini&&[0,1,2,3,4].map(i=>{const value=lower+(upper-lower)*i/4;return <g key={i}><line x1={pl} x2={w-pr} y1={y(value)} y2={y(value)} stroke="#24272b" strokeDasharray="3 6"/><text x={pl-12} y={y(value)+4} textAnchor="end" fill="#717984" fontSize="11" fontFamily="monospace">{value>0?'+':''}{value.toFixed(0)}%</text></g>;})}
      {paths[0]&&<path d={`${paths[0]} L${x(series[0].at(-1)!.timestamp)},${h-pb} L${x(series[0][0].timestamp)},${h-pb} Z`} fill={`url(#area${id})`}/>}
      {paths.map((path,i)=><path key={i} d={path} fill="none" stroke={i===0?'#b5f567':'#8093be'} strokeWidth={mini?2:2.5} strokeLinejoin="round" strokeLinecap="round"/>)}
      {!mini&&<><text x={pl} y={h-3} fill="#717984" fontSize="11" fontFamily="monospace">{new Date(minX).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</text><text x={w-pr} y={h-3} textAnchor="end" fill="#717984" fontSize="11" fontFamily="monospace">{duel.status==='COMPLETED'?'FINISH':'LATEST SNAPSHOT'}</text></>}
      {hover!==null&&!mini&&<line x1={hover} x2={hover} y1={pt} y2={h-pb} stroke="#5c626d" strokeDasharray="3 3"/>}
    </svg>{selected&&!mini&&<div className="chart-tooltip">{selected.map((s,i)=><span key={i}>{i?nameOf(duel.opponentProfile):nameOf(duel.challengerProfile)} <b>{pct(s?.returnPct)}</b></span>)}</div>}</div>
    {!mini&&<p className="chart-note">Cash-flow-adjusted return · starting index 100 · deposits don’t improve your score</p>}
  </div>;
}
