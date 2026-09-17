import { beforeEach, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { createApp } from '../../apps/worker/src/app';
import { MemoryRepository } from '../../apps/worker/src/repository';
import { CHAIN_IDS, type Chain } from '../../packages/core/src/config';
import type { Profile } from '../../packages/core/src/types';

const origin='http://127.0.0.1:5173';
const evm=privateKeyToAccount(`0x${'1'.padStart(64,'0')}`);
const evmOther=privateKeyToAccount(`0x${'2'.padStart(64,'0')}`);
const solKey=new Uint8Array(32).fill(17),solAddress=bs58.encode(ed25519.getPublicKey(solKey));
let repo:MemoryRepository,app:ReturnType<typeof createApp>['app'];
const request=(path:string,body?:unknown,cookie?:string)=>app.request(`http://local/api${path}`,{method:body?'POST':'GET',headers:{Origin:origin,'X-Duels-Request':'1','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
async function challenge(chain:Chain,wallet:string,cookie?:string,purpose='login'){
  const response=await request('/auth/nonce',{chain,wallet,purpose},cookie);expect(response.status).toBe(200);return await response.json() as {nonce:string;message:string};
}
async function login(account=evm,chain:Chain='base'){
  const n=await challenge(chain,account.address),r=await request('/auth/verify',{nonce:n.nonce,signature:await account.signMessage({message:n.message})});
  expect(r.status).toBe(200);return {profile:(await r.json()).profile as Profile,cookie:r.headers.get('set-cookie')!.split(';')[0]};
}
async function signSol(n:{nonce:string;message:string}){return {nonce:n.nonce,signature:bs58.encode(ed25519.sign(new TextEncoder().encode(n.message),solKey))};}
beforeEach(()=>{repo=new MemoryRepository();app=createApp({DEMO_MODE:'false',SESSION_SECRET:'wallet-link-unit-test-secret-at-least-32',APP_ORIGIN:origin,ADMIN_WALLETS:solAddress},repo).app;});

describe('one trader with signed Solana and EVM wallets',()=>{
  it('uses one identity and one points grant across all EVM networks',async()=>{
    const a=await login(evm,'base'),b=await login(evm,'arc');expect(b.profile.id).toBe(a.profile.id);
    const s=await repo.read();expect(s.profiles).toHaveLength(1);expect(s.ledger).toHaveLength(1);expect(s.profiles[0].wallets).toHaveLength(1);
  });
  it('requires a session to request a wallet link',async()=>expect((await request('/auth/nonce',{chain:'solana',wallet:solAddress,purpose:'link'})).status).toBe(401));
  it('binds linking to the session, consumes the proof, and allows either wallet to sign in',async()=>{
    const a=await login(),n=await challenge('solana',solAddress,a.cookie,'link'),proof=await signSol(n);
    expect(n.message).toContain(`trader account ${a.profile.id}`);
    expect((await request('/auth/verify',proof)).status).toBe(401);
    const otherSession=await login();expect((await request('/auth/verify',proof,otherSession.cookie)).status).toBe(401);
    const r=await request('/auth/verify',proof,a.cookie);expect(r.status).toBe(200);expect((await r.json()).profile.wallets).toHaveLength(2);
    expect((await request('/auth/verify',proof,r.headers.get('set-cookie')!.split(';')[0])).status).toBe(401);
    const solLogin=await challenge('solana',solAddress),signed=await request('/auth/verify',await signSol(solLogin));
    expect(signed.status).toBe(200);expect((await signed.json()).profile.id).toBe(a.profile.id);
    const cookie=signed.headers.get('set-cookie')!.split(';')[0];expect((await request('/admin',undefined,cookie)).status).toBe(200);
    expect((await repo.read()).ledger).toHaveLength(1);
  });
  it('will not attach an address already owned by another trader',async()=>{
    const n=await challenge('solana',solAddress);expect((await request('/auth/verify',await signSol(n))).status).toBe(200);
    const a=await login(),link=await challenge('solana',solAddress,a.cookie,'link');
    expect((await request('/auth/verify',await signSol(link),a.cookie)).status).toBe(409);
    expect((await repo.read()).profiles.find(p=>p.id===a.profile.id)!.wallets).toHaveLength(1);
  });
  it('prevents concurrent claims of the same wallet',async()=>{
    const a=await login(),b=await login(evmOther),na=await challenge('solana',solAddress,a.cookie,'link'),nb=await challenge('solana',solAddress,b.cookie,'link');
    const results=await Promise.all([request('/auth/verify',await signSol(na),a.cookie),request('/auth/verify',await signSol(nb),b.cookie)]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect((await repo.read()).profiles.filter(p=>p.wallets?.some(w=>w.address===solAddress))).toHaveLength(1);
  });
  it('rejects a second wallet of the same family and preserves the first',async()=>{
    const a=await login(),n=await challenge('base',evmOther.address,a.cookie,'link');
    expect((await request('/auth/verify',{nonce:n.nonce,signature:await evmOther.signMessage({message:n.message})},a.cookie)).status).toBe(409);
    expect((await repo.read()).profiles[0].wallets?.[0].address).toBe(evm.address.toLowerCase());
  });
  it('creates every live duel across all enabled chains, even with a legacy chain parameter',async()=>{
    const a=await login();const body={opponent:'@rival',stake:'100',duration:86400000,chain:'base'};
    const create=(cookie:string)=>app.request('http://local/api/duels',{method:'POST',headers:{Origin:origin,'X-Duels-Request':'1','Content-Type':'application/json','Idempotency-Key':crypto.randomUUID(),Cookie:cookie},body:JSON.stringify(body)});
    expect((await create(a.cookie)).status).toBe(400);
    const n=await challenge('solana',solAddress,a.cookie,'link'),r=await request('/auth/verify',await signSol(n),a.cookie),cookie=r.headers.get('set-cookie')!.split(';')[0];
    const b=await login(evmOther);await repo.transact(s=>{s.profiles.find(p=>p.id===b.profile.id)!.username='rival';});
    const created=await create(cookie);expect(created.status).toBe(201);const duel=await created.json();expect(duel.chains).toEqual([...CHAIN_IDS]);expect(duel.rulesVersion).toBe('twr-portfolio-v1');
    // The opponent's missing Solana proof blocks acceptance before provider calls.
    expect((await request(`/duels/${duel.id}/accept`,{},b.cookie)).status).toBe(422);
  });
});
