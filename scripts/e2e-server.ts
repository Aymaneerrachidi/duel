import { createServer } from 'vite';
import { serve } from '@hono/node-server';
import { readFile } from 'node:fs/promises';
import { MemoryRepository } from '../apps/worker/src/repository';
import { createApp } from '../apps/worker/src/app';
import { seedDemo } from '../packages/core/src/demo';
import { initializePng } from '../apps/worker/src/png';
// Deliberately ignore .env and never connect the browser test to a user's store.
const png=await initializePng(await readFile('node_modules/@resvg/resvg-wasm/index_bg.wasm'),await readFile('apps/worker/assets/IBMPlexSans.ttf'));
const runtime=createApp({DEMO_MODE:'true',APP_ORIGIN:'http://127.0.0.1:5174'},new MemoryRepository(await seedDemo()),png);
// Isolated live-auth fixtures exist only in this local test server. Each browser
// test gets its own memory store, with real nonce verification and session cookies.
const walletFixtures=new Map<string,ReturnType<typeof createApp>>();
const api=serve({fetch:request=>{
  const url=new URL(request.url),match=url.pathname.match(/^\/__test_wallet\/([a-f0-9-]{36})(\/api\/.*)$/);
  if(!match)return runtime.app.fetch(request);
  let fixture=walletFixtures.get(match[1]);
  if(!fixture){fixture=createApp({DEMO_MODE:'false',APP_ORIGIN:'http://127.0.0.1:5174',SESSION_SECRET:'isolated-browser-wallet-test-secret-32'},new MemoryRepository());walletFixtures.set(match[1],fixture);}
  url.pathname=match[2];return fixture.app.fetch(new Request(url,request));
},port:8788,hostname:'127.0.0.1'});
const web=await createServer({server:{port:5174,host:'127.0.0.1',strictPort:true,proxy:{'/api':'http://127.0.0.1:8788','/og':'http://127.0.0.1:8788','/__test_wallet':'http://127.0.0.1:8788'}}});
await web.listen();web.printUrls();
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{api.close();void web.close().then(()=>process.exit(0));});
