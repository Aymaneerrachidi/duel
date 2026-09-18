import { duelStakeSymbol } from '../../../packages/core/src/portfolio.js';
import { PRODUCT } from '../../../packages/core/src/config.js';
import type { DuelView } from '../../../packages/core/src/types.js';
const esc=(v:string)=>v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function shareSvg(d:DuelView){
  const a=esc(d.challengerProfile.username||d.challengerProfile.wallet.slice(0,8)),b=esc(d.opponentProfile.username||d.opponentProfile.wallet.slice(0,8));
  const value=(n:number|undefined)=>n===undefined?'—':`${n>=0?'+':''}${n.toFixed(2)}%`;
  const color=(n:number|undefined)=>n===undefined||n===0?'#626b83':n>0?'#217755':'#bd3e56';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f5f7fc"/>
  <rect x="48" y="42" width="48" height="48" rx="14" fill="#3558f5"/><path d="m59 76 11-24h9l-11 24Z" fill="white"/><path d="m74 79 9-21h6l-9 21Z" fill="#ffc2a9"/>
  <text x="112" y="77" fill="#252847" font-family="Arial,sans-serif" font-size="29" font-weight="700">${esc(PRODUCT.name)}</text>
  <text x="1150" y="72" fill="#626b83" text-anchor="end" font-family="Arial,sans-serif" font-size="16">${d.demo?'DEMO · ':''}${d.status} · SIMULATED STAKES</text>
  <rect x="48" y="132" width="536" height="334" rx="30" fill="#e9edff"/><rect x="616" y="132" width="536" height="334" rx="30" fill="#ffebe0"/>
  <text x="87" y="184" fill="#3558f5" font-family="Arial,sans-serif" font-size="16">IN THIS CORNER</text><text x="655" y="184" fill="#ad4a2f" font-family="Arial,sans-serif" font-size="16">ACROSS THE ARENA</text>
  <text x="87" y="270" fill="#252847" font-family="Arial,sans-serif" font-weight="700" font-size="${a.length>16?32:44}">${a}</text>
  <text x="655" y="270" fill="#252847" font-family="Arial,sans-serif" font-weight="700" font-size="${b.length>16?32:44}">${b}</text>
  <text x="87" y="370" fill="${color(d.challengerReturn)}" font-family="Arial,sans-serif" font-weight="700" font-size="76">${value(d.challengerReturn)}</text>
  <text x="655" y="370" fill="${color(d.opponentReturn)}" font-family="Arial,sans-serif" font-weight="700" font-size="76">${value(d.opponentReturn)}</text>
  <text x="87" y="419" fill="#626b83" font-family="Arial,sans-serif" font-size="16">Adjusted portfolio return</text><text x="655" y="419" fill="#626b83" font-family="Arial,sans-serif" font-size="16">Adjusted portfolio return</text>
  <circle cx="600" cy="304" r="35" fill="white"/><text x="600" y="313" text-anchor="middle" fill="#252847" font-family="Arial,sans-serif" font-size="25" font-weight="700">vs</text>
  <text x="48" y="537" fill="#252847" font-family="Arial,sans-serif" font-size="25" font-weight="700">${Number(d.stake)*2} ${duelStakeSymbol(d)} simulated pot · ${Math.round(d.duration/86400000)} days</text>
  <text x="48" y="574" fill="#626b83" font-family="Arial,sans-serif" font-size="17">Good trades. Great rivalries.</text><text x="1152" y="553" fill="#3558f5" text-anchor="end" font-family="Arial,sans-serif" font-size="23" font-weight="700">${d.status==='COMPLETED'?'The results are in.':'Who takes the win?'}</text></svg>`;
}
