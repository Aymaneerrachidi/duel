import { SupabaseRepository } from './repository.js';
import { createApp } from './app.js';
import { seedDemo } from '../../../packages/core/src/demo.js';
import { isDemo, type Env } from '../../../packages/core/src/config.js';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import font from '../assets/IBMPlexSans.ttf';
import { initializePng } from './png.js';
import { socialMetadata } from './metadata.js';
import { duelView } from '../../../packages/core/src/views.js';
type Bindings=Env&{ASSETS:{fetch:(request:Request)=>Promise<Response>}};
let runtime:ReturnType<typeof createApp>|undefined;
function securePage(response:Response){const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('X-Frame-Options','DENY');headers.set('Referrer-Policy','strict-origin-when-cross-origin');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https: wss:; font-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");return new Response(response.body,{status:response.status,headers});}
async function setup(env:Bindings){if(runtime)return runtime;const repo=new SupabaseRepository(env);const state=await repo.read();if(state.profiles.some(p=>p.demo!==isDemo(env)))throw new Error('Demo and live data require separate databases');if(isDemo(env)&&!state.profiles.length){const seed=await seedDemo();await repo.transact(s=>{if(!s.profiles.length)Object.assign(s,seed);});}let png:ReturnType<typeof initializePng>|undefined;runtime=createApp(env,repo,async svg=>{png??=initializePng(resvgWasm,new Uint8Array(font));return (await png)(svg);});return runtime;}
export default {
  async fetch(request:Request,env:Bindings){try{
    const url=new URL(request.url),path=url.pathname;
    if(!path.startsWith('/api/')&&!path.startsWith('/og/')&&!/^\/(d|challenge)\/[A-Z0-9]+$/.test(path))return securePage(await env.ASSETS.fetch(request));
    const {app,service}=await setup(env);
    if(path.startsWith('/api/')||path.startsWith('/og/'))return app.fetch(request);
    const response=await env.ASSETS.fetch(request);if(!response.headers.get('Content-Type')?.includes('text/html'))return response;
    const s=await service.repo.read(),duel=s.duels.find(d=>d.slug===path.split('/')[2]);
    const metadata=socialMetadata(duel?duelView(s,duel):null,env.APP_ORIGIN??url.origin);
    const html=(await response.text()).replace(/<title>[^<]*<\/title>/,'').replace('</head>',metadata+'</head>');
    return securePage(new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':duel?.visibility==='PUBLIC'?'public, max-age=30':'no-store'}}));
  }catch{return Response.json({error:'Server configuration incomplete. Check Supabase migrations and Worker secrets.'},{status:503});}},
  async scheduled(_controller:unknown,env:Bindings,ctx:{waitUntil:(p:Promise<unknown>)=>void}){ctx.waitUntil(setup(env).then(({service})=>service.tick()));}
};
