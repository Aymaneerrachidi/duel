import { PRODUCT } from '../../../packages/core/src/config.js';
import type { DuelView } from '../../../packages/core/src/types.js';
const escape=(text:string)=>text.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function socialMetadata(duel:DuelView|null,origin:string){
  if(!duel||duel.visibility!=='PUBLIC')return '<meta name="robots" content="noindex,nofollow"/>';
  const name=(p:DuelView['challengerProfile'])=>p.username?`@${p.username}`:p.wallet.slice(0,8);
  const title=`${name(duel.challengerProfile)} vs ${name(duel.opponentProfile)} | ${PRODUCT.name}`;
  const description=`${duel.demo?'Demo duel. ':''}${duel.duration/86400000}-day portfolio performance challenge. ${duel.status==='COMPLETED'?'Final result available.':'Follow the duel.'} Stakes are simulated.`;
  const fields={'og:type':'website','og:title':title,'og:description':description,'og:url':`${origin}/d/${duel.slug}`,'og:image':`${origin}/og/${duel.slug}.png`,'og:image:width':'1200','og:image:height':'630','twitter:card':'summary_large_image','twitter:title':title,'twitter:description':description,'twitter:image':`${origin}/og/${duel.slug}.png`};
  return `<title>${escape(title)}</title>`+Object.entries(fields).map(([key,value])=>`<meta ${key.startsWith('twitter')?'name':'property'}="${key}" content="${escape(value)}"/>`).join('');
}
