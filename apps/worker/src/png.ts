import { Resvg, initWasm } from '@resvg/resvg-wasm';
let initialized:Promise<void>|undefined;
export async function initializePng(wasm:WebAssembly.Module|BufferSource,font:Uint8Array){initialized??=initWasm(wasm);await initialized;return async(svg:string)=>{const renderer=new Resvg(svg,{font:{fontBuffers:[font],defaultFontFamily:'IBM Plex Sans',loadSystemFonts:false}});try{return renderer.render().asPng();}finally{renderer.free();}};}
