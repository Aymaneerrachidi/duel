import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { PRODUCT } from './packages/core/src/config';
export default defineConfig({
  root: 'apps/web', plugins: [react(), tailwindcss(), {name:'product-title',transformIndexHtml:html=>html.replace('__PRODUCT_NAME__',PRODUCT.name.replaceAll('&','&amp;').replaceAll('<','&lt;'))}],
  resolve: { alias: { '@shared': resolve('packages/core/src') } },
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787', '/og': 'http://127.0.0.1:8787' } },
  build: { outDir: '../../dist', emptyOutDir: true, rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], wallet: ['viem', '@wallet-standard/app'] } } } }
});
