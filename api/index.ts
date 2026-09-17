import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '@hono/node-server/vercel';
import { createApp } from '../apps/worker/src/app.js';
import { SupabaseRepository } from '../apps/worker/src/repository.js';
import { initializePng } from '../apps/worker/src/png.js';
import { socialMetadata } from '../apps/worker/src/metadata.js';
import { duelView } from '../packages/core/src/views.js';
import { isDemo } from '../packages/core/src/config.js';

export const config={api:{bodyParser:false}};
let ready:Promise<ReturnType<typeof handle>>|undefined;
async function setup(){
  const env=process.env,repo=new SupabaseRepository(env);
  if((await repo.read()).profiles.some(p=>p.demo!==isDemo(env)))throw new Error('Database mode mismatch');
  let png:ReturnType<typeof initializePng>|undefined;
  const {app}=createApp(env,repo,async svg=>{
    png??=Promise.all([readFile(resolve('apps/worker/assets/resvg.wasm')),readFile(resolve('apps/worker/assets/IBMPlexSans.ttf'))]).then(([wasm,font])=>initializePng(wasm,font));
    return (await png)(svg);
  });
  app.get('*',async c=>{
    if(c.req.path.startsWith('/api/')||c.req.path.startsWith('/og/'))return c.json({error:'Not found'},404);
    const html=await readFile(resolve('dist/index.html'),'utf8');
    const match=c.req.path.match(/^\/(?:d|challenge)\/([A-Z0-9]+)$/);
    if(!match)return c.html(html);
    const state=await repo.read(),duel=state.duels.find(d=>d.slug===match[1]);
    c.header('Cache-Control',duel?.visibility==='PUBLIC'?'public, max-age=30':'no-store');
    return c.html(html.replace(/<title>[^<]*<\/title>/,'').replace('</head>',socialMetadata(duel?duelView(state,duel):null,env.APP_ORIGIN!)+ '</head>'));
  });
  return handle(app);
}
export default async function handler(req:IncomingMessage,res:ServerResponse){
  try{ready??=setup().catch(error=>{ready=undefined;throw error;});await (await ready)(req,res);}
  catch{res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Service temporarily unavailable. Please retry.'}));}
}
