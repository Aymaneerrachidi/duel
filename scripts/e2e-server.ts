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
const api=serve({fetch:runtime.app.fetch,port:8788,hostname:'127.0.0.1'});
const web=await createServer({server:{port:5174,host:'127.0.0.1',strictPort:true,proxy:{'/api':'http://127.0.0.1:8788','/og':'http://127.0.0.1:8788'}}});
await web.listen();web.printUrls();
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{api.close();void web.close().then(()=>process.exit(0));});
