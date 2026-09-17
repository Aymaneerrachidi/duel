import { copyFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
// Materialize the WASM asset: Vercel includeFiles must not package a pnpm symlink.
await mkdir(resolve('apps/worker/assets'),{recursive:true});
await copyFile(resolve('node_modules/@resvg/resvg-wasm/index_bg.wasm'),resolve('apps/worker/assets/resvg.wasm'));
