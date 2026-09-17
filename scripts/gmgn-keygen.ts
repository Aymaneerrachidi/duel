import { generateKeyPairSync } from 'node:crypto';
import { mkdir,writeFile,access } from 'node:fs/promises';
import { resolve } from 'node:path';
const directory=resolve('.data/gmgn');await mkdir(directory,{recursive:true});
const privatePath=resolve(directory,'private.pem'),publicPath=resolve(directory,'public.pem');
try{await access(privatePath);console.log('A GMGN key pair already exists. Reusing it; private material is not printed.');}catch{const keys=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});await writeFile(privatePath,keys.privateKey,{mode:0o600,flag:'wx'});await writeFile(publicPath,keys.publicKey,{mode:0o644,flag:'wx'});}
console.log(`Public key to submit: ${publicPath}`);console.log('Open https://gmgn.ai/ai and submit ONLY the public key. Save the issued API key in server configuration. The read-only integration does not need your private key or wallet trading permissions.');
