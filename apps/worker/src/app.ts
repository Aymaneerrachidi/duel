import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { verifyMessage } from 'viem';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { CHAIN_IDS, CHAINS, PRODUCT, RULES, enforceSafety, isDemo, enabledChains, type Env } from '../../../packages/core/src/config.js';
import { hashResult, transition } from '../../../packages/core/src/pnl.js';
import { duelView, pointsFor, statsFor, settlePredictions } from '../../../packages/core/src/views.js';
import { linkedWallets, ownsAddress, PORTFOLIO_RULES_VERSION, walletFamily, walletKey } from '../../../packages/core/src/portfolio.js';
import type { Profile } from '../../../packages/core/src/types.js';
import type { Repository } from './repository.js';
import { Analytics } from './analytics.js';
import { QuotaManager, Transport } from './providers/transport.js';
import { Prices } from './providers/prices.js';
import { Rpc } from './providers/rpc.js';
import { GmgnProvider } from './providers/gmgn.js';
import { AppError, createSchema, DuelService, ensureProfile, linkVerifiedWallet, normalizeWallet } from './service.js';
import { shareSvg } from './share.js';
type Variables={profile:Profile|undefined;sessionId:string|undefined;requestId:string};
export function createApp(env:Env,repo:Repository,renderPng?:(svg:string)=>Promise<Uint8Array>){
  enforceSafety(env);const app=new Hono<{Variables:Variables}>();const http=new Transport(new QuotaManager(repo,env));const prices=new Prices(http,repo,env);const rpcs=new Map(CHAIN_IDS.map(c=>[c,new Rpc(c,env,http)]));const analytics=new Analytics(c=>rpcs.get(c)!,prices,repo,http);const service=new DuelService(repo,env,analytics);const gmgn=new GmgnProvider(http,env);
  const origin=env.APP_ORIGIN??'http://127.0.0.1:5173';const secure=!/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin);
  app.use('*',secureHeaders({contentSecurityPolicy:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'https:','data:'],connectSrc:["'self'",'https:','wss:'],fontSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"],baseUri:["'self'"]}}));
  app.use('*',bodyLimit({maxSize:16384,onError:c=>c.json({error:'Request exceeds 16 KB.'},413)}));
  app.get('/api/cron',async c=>{
    c.header('Cache-Control','no-store');
    const supplied=c.req.header('Authorization')??'';
    if(!env.CRON_SECRET||env.CRON_SECRET.length<32||await hashResult(supplied)!==await hashResult(`Bearer ${env.CRON_SECRET}`))return c.json({error:'Unauthorized'},401);
    await service.tick();return c.json({ok:true,checkedAt:Date.now()});
  });
  app.use('/api/*',async(c,next)=>{
    const start=Date.now(),requestId=crypto.randomUUID();c.set('requestId',requestId);c.header('X-Request-ID',requestId);c.header('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(c.req.method)){if(c.req.header('Origin')!==origin||c.req.header('X-Duels-Request')!=='1')throw new AppError('Request origin could not be verified.',403);if(!c.req.header('Content-Type')?.includes('application/json'))throw new AppError('Use application/json.',415);}
    const token=getCookie(c,'duels_session');let sessionId:string|undefined;
    if(token){sessionId=await hashResult(`${token}:${env.SESSION_SECRET??'local-demo'}`);const state=await repo.read();const session=state.sessions.find(s=>s.id===sessionId&&s.expiresAt>Date.now()&&s.demo===isDemo(env));if(session)c.set('profile',state.profiles.find(p=>p.id===session.profileId));}c.set('sessionId',sessionId);
    // Hash addresses into short-lived counters; do not retain IP logs.
    const ip=env.VERCEL==='1'?c.req.header('x-forwarded-for')?.split(',')[0]?.trim():c.req.header('CF-Connecting-IP');
    const actor=c.get('profile')?.id??await hashResult(`${new Date().toISOString().slice(0,10)}:${ip??'local'}`);const window=Math.floor(Date.now()/60000);const key=`user-rate:${actor}:${window}`;
    if(!await repo.rateLimit(key,c.get('profile')?120:30,Date.now()+120000))throw new AppError('Too many requests. Try again in a minute.',429);
    await next();console.info(JSON.stringify({requestId,method:c.req.method,path:c.req.path.replace(/\/trader\/[^/]+/,'/trader/:id'),status:c.res.status,durationMs:Date.now()-start}));
  });
  const requireProfile=(p:Profile|undefined)=>{if(!p)throw new AppError('Connect your wallet first.',401);return p;};
  const isAdmin=(p:Profile|undefined)=>!!p&&(p.demo&&isDemo(env)&&p.username==='you'||linkedWallets(p).some(w=>(env.ADMIN_WALLETS??'').split(',').some(a=>walletKey(w.family,a.trim())===walletKey(w.family,w.address))));
  app.get('/api/bootstrap',async c=>{const s=await repo.read(),profile=c.get('profile');const publicDuels=s.duels.filter(d=>d.visibility==='PUBLIC');return c.json({product:PRODUCT,mode:isDemo(env)?'demo':'live',serverTime:Date.now(),chains:enabledChains(env),profile,points:profile?pointsFor(s,profile.id):null,admin:isAdmin(profile),duels:publicDuels.sort((a,b)=>b.createdAt-a.createdAt).slice(0,80).map(d=>duelView(s,d)),traders:s.profiles.filter(p=>s.duels.some(d=>d.visibility==='PUBLIC'&&(d.challenger===p.id||d.opponent===p.id))).map(p=>({...p,stats:statsFor(s,p.id)})).sort((a,b)=>b.stats.wins-a.stats.wins),events:s.events.filter(e=>publicDuels.some(d=>d.id===e.duelId)).sort((a,b)=>b.createdAt-a.createdAt).slice(0,12),rules:RULES});});
  app.get('/api/me',async c=>{const p=c.get('profile');const s=await repo.read();return c.json({profile:p??null,points:p?pointsFor(s,p.id):null,admin:isAdmin(p)});});
  app.post('/api/auth/nonce',async c=>{
    if(isDemo(env))throw new AppError('Use the demo persona selector in demo mode.');const input=z.object({chain:z.enum(CHAIN_IDS),wallet:z.string().max(100),purpose:z.enum(['login','link']).default('login'),evmChainId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional()}).parse(await c.req.json());const wallet=normalizeWallet(input.chain,input.wallet);const nonce=crypto.randomUUID().replaceAll('-','');const now=Date.now(),expiresAt=now+300000;const domain=new URL(origin).host;
    const profile=input.purpose==='link'?requireProfile(c.get('profile')):undefined;
    const statement=profile?`Link this wallet to your ${PRODUCT.name} trader account ${profile.id}. All supported chains contribute to one portfolio.`:`Sign in to ${PRODUCT.name}.`;
    const message=`${domain} wants you to sign in with your ${input.chain==='solana'?'Solana':'Ethereum'} account:\n${wallet}\n\n${statement} This signature does not authorize a transaction.\n\nURI: ${origin}\nVersion: 1\nChain ID: ${input.chain==='solana'?'solana:mainnet':input.evmChainId??CHAINS[input.chain].id}\nNonce: ${nonce}\nIssued At: ${new Date(now).toISOString()}\nExpiration Time: ${new Date(expiresAt).toISOString()}`;
    await repo.transact(s=>{s.nonces=s.nonces.filter(n=>!(n.wallet===wallet&&walletFamily(n.chain)===walletFamily(input.chain)&&n.purpose===input.purpose&&n.profileId===profile?.id));s.nonces.push({id:nonce,wallet,chain:input.chain,message,expiresAt,purpose:input.purpose,...(profile?{profileId:profile.id,sessionId:c.get('sessionId')}: {})});});return c.json({nonce,message,expiresAt});
  });
  app.post('/api/auth/verify',async c=>{
    if(isDemo(env))throw new AppError('Wallet authentication is disabled in demo mode.');const input=z.object({nonce:z.string().length(32),signature:z.string().max(512)}).parse(await c.req.json());const state=await repo.read();const n=state.nonces.find(n=>n.id===input.nonce&&n.expiresAt>Date.now());if(!n)throw new AppError('Challenge expired. Reconnect your wallet.',401);
    if(n.purpose==='link'&&(!c.get('profile')||c.get('profile')!.id!==n.profileId||c.get('sessionId')!==n.sessionId))throw new AppError('Finish linking from the same signed-in account and browser session.',401);
    let valid=false;try{valid=n.chain==='solana'?ed25519.verify(bs58.decode(input.signature),new TextEncoder().encode(n.message),bs58.decode(n.wallet)):await verifyMessage({address:n.wallet as `0x${string}`,message:n.message,signature:input.signature as `0x${string}`});}catch{/* Invalid signature. */}if(!valid)throw new AppError('Wallet signature is invalid.',401);
    const token=crypto.randomUUID()+crypto.randomUUID(),id=await hashResult(`${token}:${env.SESSION_SECRET}`);
    const profile=await repo.transact(s=>{
      const unused=s.nonces.find(v=>v.id===n.id&&v.expiresAt>Date.now());if(!unused)throw new AppError('Challenge was already used.',401);
      if(n.purpose==='link'&&!s.sessions.some(v=>v.id===n.sessionId&&v.profileId===n.profileId&&v.expiresAt>Date.now()))throw new AppError('Your linking session expired. Sign in again.',401);
      const p=n.purpose==='link'?s.profiles.find(p=>p.id===n.profileId)!:ensureProfile(s,n.chain,n.wallet);
      linkVerifiedWallet(s,p,n.chain,n.wallet);s.nonces=s.nonces.filter(v=>v.id!==n.id);
      // Rotate the session after adding an identity. The signed link cannot be replayed.
      if(n.purpose==='link')s.sessions=s.sessions.filter(v=>v.id!==n.sessionId);
      s.sessions.push({id,profileId:p.id,expiresAt:Date.now()+4*3600000,demo:false});
      s.controls=s.controls.filter(v=>v.id!==`inspection:${p.id}`);
      return p;
    });setCookie(c,'duels_session',token,{httpOnly:true,secure,sameSite:'Lax',path:'/',maxAge:14400});return c.json({profile});
  });
  app.post('/api/auth/demo',async c=>{if(!isDemo(env))throw new AppError('Demo access is disabled.',404);const {profileId}=z.object({profileId:z.string().max(80)}).parse(await c.req.json());const token=crypto.randomUUID()+crypto.randomUUID(),id=await hashResult(`${token}:${env.SESSION_SECRET??'local-demo'}`);const profile=await repo.transact(s=>{const p=s.profiles.find(p=>p.id===profileId&&p.demo);if(!p)throw new AppError('Choose a demo trader.');s.sessions.push({id,profileId:p.id,expiresAt:Date.now()+86400000,demo:true});return p;});setCookie(c,'duels_session',token,{httpOnly:true,secure,sameSite:'Lax',path:'/',maxAge:86400});return c.json({profile});});
  app.post('/api/auth/logout',async c=>{const id=c.get('sessionId');await repo.transact(s=>{s.sessions=s.sessions.filter(v=>v.id!==id);});deleteCookie(c,'duels_session',{path:'/'});return c.json({ok:true});});
  app.get('/api/duels/:slug',async c=>{const s=await repo.read(),d=s.duels.find(d=>d.slug===c.req.param('slug'));if(!d)throw new AppError('Duel not found.',404);return c.json({duel:duelView(s,d),snapshots:s.snapshots.filter(v=>v.duelId===d.id),flows:s.cashflows.filter(v=>v.duelId===d.id),transactions:s.transactions.filter(v=>v.duelId===d.id).slice(-40).reverse(),events:s.events.filter(v=>v.duelId===d.id).sort((a,b)=>b.createdAt-a.createdAt),predictions:s.predictions.filter(v=>v.duelId===d.id&&v.profileId===c.get('profile')?.id),serverTime:Date.now()});});
  app.post('/api/duels',async c=>{const p=requireProfile(c.get('profile'));const key=c.req.header('Idempotency-Key');if(!key||key.length>100)throw new AppError('An idempotency key is required.');return c.json(await service.create(p.id,createSchema.parse(await c.req.json()),key),201);});
  app.post('/api/duels/:id/accept',async c=>{const p=requireProfile(c.get('profile'));return c.json(await service.accept(c.req.param('id'),p.id));});
  app.post('/api/duels/:id/cancel',async c=>{const p=requireProfile(c.get('profile'));return c.json(await service.cancel(c.req.param('id'),p.id));});
  app.post('/api/duels/:id/predict',async c=>{const p=requireProfile(c.get('profile'));const input=z.object({side:z.string().max(100),points:z.number().int().min(10).max(10000)}).parse(await c.req.json());const id=c.req.param('id');return c.json(await repo.transact(s=>{const d=s.duels.find(d=>d.id===id);if(!d)throw new AppError('Duel not found.',404);if(d.status!=='ACTIVE'||Date.now()>=d.startsAt!+d.duration*RULES.predictionCutoffFraction)throw new AppError('Predictions are closed for this duel.');if([d.challenger,d.opponent].includes(p.id))throw new AppError('Participants cannot predict their own duel.');if(![d.challenger,d.opponent].includes(input.side))throw new AppError('Choose a participant.');if(s.predictions.some(v=>v.duelId===id&&v.profileId===p.id))throw new AppError('You already backed a side in this duel.',409);if(pointsFor(s,p.id)<input.points)throw new AppError('Not enough duel points.');const prediction={id:crypto.randomUUID(),duelId:id,profileId:p.id,side:input.side,points:input.points,createdAt:Date.now()};s.predictions.push(prediction);s.ledger.push({id:`stake-${prediction.id}`,profileId:p.id,delta:-input.points,reason:'Prediction placed',duelId:id,createdAt:Date.now()});return prediction;}),201);});
  app.get('/api/traders/:id',async c=>{const s=await repo.read();const id=c.req.param('id');const p=s.profiles.find(p=>p.id===id||ownsAddress(p,id.startsWith('0x')?'ethereum':'solana',id)||p.username===id.toLowerCase().replace(/^@/,''));if(!p)throw new AppError('Trader not found.',404);return c.json({profile:p,stats:statsFor(s,p.id),duels:s.duels.filter(d=>d.visibility==='PUBLIC'&&(d.challenger===p.id||d.opponent===p.id)).map(d=>duelView(s,d))});});
  app.patch('/api/profile',async c=>{const p=requireProfile(c.get('profile'));const {username}=z.object({username:z.string().toLowerCase().regex(/^[a-z0-9_]{3,20}$/)}).parse(await c.req.json());return c.json(await repo.transact(s=>{const current=s.profiles.find(v=>v.id===p.id)!;if(current.username===username)return current;if(current.usernameChangedAt&&Date.now()-current.usernameChangedAt<7*86400000)throw new AppError('You can change your username once every seven days.');if(s.profiles.some(v=>v.id!==p.id&&v.username===username))throw new AppError('That username is already taken.');current.username=username;current.usernameChangedAt=Date.now();return current;}));});
  app.post('/api/follow/:id',async c=>{const p=requireProfile(c.get('profile'));return c.json(await repo.transact(s=>{const target=c.req.param('id');if(!s.profiles.some(v=>v.id===target)||target===p.id)throw new AppError('Choose another trader.');const current=s.profiles.find(v=>v.id===p.id)!;current.following=current.following.includes(target)?current.following.filter(v=>v!==target):[...current.following,target];return {following:current.following};}));});
  app.get('/api/notifications',async c=>{const p=requireProfile(c.get('profile'));const s=await repo.read();const duelIds=new Set(s.duels.filter(d=>[d.challenger,d.opponent].includes(p.id)||d.visibility==='PUBLIC'&&(p.following.includes(d.challenger)||p.following.includes(d.opponent))).map(d=>d.id));return c.json(s.events.filter(e=>duelIds.has(e.duelId)).sort((a,b)=>b.createdAt-a.createdAt).slice(0,40));});
  app.get('/api/portfolio',async c=>{
    const p=requireProfile(c.get('profile'));if(p.demo)throw new AppError('Live wallet inspection is available after disabling demo mode.');
    const s=await repo.read(),key=`inspection:${p.id}`;const cached=s.controls.find(v=>v.id===key&&v.expiresAt!>Date.now());if(cached)return c.json(JSON.parse(cached.value));
    if(!await repo.rateLimit(`inspection:${p.id}:${Math.floor(Date.now()/300000)}`,1,Date.now()+300000))throw new AppError('Wallet inspection refreshes once every five minutes.',429);
    const inspection={id:`inspect-${p.id}`,chain:'solana',chains:enabledChains(env),rulesVersion:PORTFOLIO_RULES_VERSION} as Parameters<Analytics['snapshot']>[0],result=await analytics.snapshot(inspection,p,'optional');
    await repo.transact(s=>{s.controls=s.controls.filter(v=>v.id!==key);s.controls.push({id:key,value:JSON.stringify(result),expiresAt:Date.now()+300000});});return c.json(result);
  });
  app.get('/api/market/:chain',async c=>{requireProfile(c.get('profile'));const chain=z.enum(CHAIN_IDS).parse(c.req.param('chain'));return c.json(await gmgn.trending(chain));});
  app.get('/api/admin',async c=>{if(!isAdmin(c.get('profile')))throw new AppError('This area is restricted to configured admin wallets.',403);const s=await repo.read();return c.json({usage:s.usage,paused:s.controls.find(v=>v.id==='paused')?.value==='true',cron:s.controls.find(v=>v.id==='last-cron')?.value,disputed:s.duels.filter(d=>d.status==='DISPUTED').map(d=>duelView(s,d)),audit:s.audit.slice(-30).reverse(),flags:{demo:isDemo(env),realMoney:false,paidProviders:false,escrow:'simulated'},configured:{helius:!!env.HELIUS_API_KEY,alchemy:!!env.ALCHEMY_API_KEY,jupiter:!!env.JUPITER_API_KEY,gmgn:!!env.GMGN_API_KEY,supabase:!!env.SUPABASE_URL}});});
  app.post('/api/admin/pause',async c=>{const p=c.get('profile');if(!isAdmin(p))throw new AppError('Administrator access required.',403);const {paused}=z.object({paused:z.boolean()}).parse(await c.req.json());await repo.transact(s=>{s.controls=s.controls.filter(v=>v.id!=='paused');s.controls.push({id:'paused',value:String(paused)});s.audit.push({id:crypto.randomUUID(),actor:p!.id,action:paused?'Paused new duels':'Resumed new duels',createdAt:Date.now()});});return c.json({paused});});
  app.post('/api/admin/duels/:id/refund',async c=>{const p=c.get('profile');if(!isAdmin(p))throw new AppError('Administrator access required.',403);const {reason}=z.object({reason:z.string().trim().min(10).max(500)}).parse(await c.req.json());const result=await repo.transact(s=>{const d=s.duels.find(d=>d.id===c.req.param('id'));if(!d)throw new AppError('Duel not found.',404);if(d.status==='CANCELLED')return d;if(d.status!=='DISPUTED')throw new AppError('Only disputed duels can be refunded from review.',409);transition(d,'CANCELLED');settlePredictions(s,d);s.events.push({id:crypto.randomUUID(),duelId:d.id,type:'CANCELLED',text:`Review closed with points refunded: ${reason}`,createdAt:Date.now()});s.audit.push({id:crypto.randomUUID(),actor:p!.id,action:`Refunded points for ${d.slug}: ${reason}`,createdAt:Date.now()});return d;});return c.json(result);});
  app.post('/api/demo/finish/:id',async c=>{if(!isDemo(env))throw new AppError('Demo controls are disabled.',404);requireProfile(c.get('profile'));await service.update(c.req.param('id'),true);return c.json({ok:true});});
  app.get('/api/health',c=>c.json({status:'ok',mode:isDemo(env)?'demo':'live',version:PRODUCT.version}));
  const imageCache=new Map<string,{bytes:Uint8Array;expires:number}>();
  app.get('/og/:file',async c=>{const file=c.req.param('file');const match=/^([A-Z0-9]+)\.(svg|png)$/.exec(file);if(!match)throw new AppError('Share image not found.',404);const s=await repo.read();const d=s.duels.find(v=>v.slug===match[1]&&v.visibility==='PUBLIC');if(!d)throw new AppError('Share image not found.',404);c.header('Cache-Control',d.status==='COMPLETED'?'public, max-age=31536000, immutable':'public, max-age=60');const svg=shareSvg(duelView(s,d));if(match[2]==='png'){if(!renderPng)throw new AppError('PNG rendering unavailable.',503);let cached=imageCache.get(file);if(!cached||cached.expires<Date.now()){cached={bytes:await renderPng(svg),expires:Date.now()+60000};if(imageCache.size>100)imageCache.clear();imageCache.set(file,cached);}c.header('Content-Type','image/png');return c.body(cached.bytes as Uint8Array<ArrayBuffer>);}c.header('Content-Type','image/svg+xml');return c.body(svg);});
  app.onError((error,c)=>{if(error instanceof z.ZodError)return c.json({error:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')},400);if(error instanceof AppError)return c.json({error:error.message},error.status as 400);console.error(JSON.stringify({requestId:c.get('requestId'),error:error.name}));return c.json({error:'The request could not be completed. Try again shortly.'},503);});
  return {app,service};
}
