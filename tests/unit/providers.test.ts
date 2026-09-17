import { describe,it,expect,vi } from 'vitest';
import { MemoryRepository } from '../../apps/worker/src/repository';
import { QuotaManager,Transport } from '../../apps/worker/src/providers/transport';
import { Rpc } from '../../apps/worker/src/providers/rpc';
import { GmgnProvider } from '../../apps/worker/src/providers/gmgn';
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
describe('provider budgets, failures and coalescing',()=>{
  it('generates fresh GMGN auth after quota waits and coalesces/cache hits without spending again',async()=>{
    vi.useFakeTimers();
    try{
      const base=Date.now(),quota=new QuotaManager(new MemoryRepository(),{});vi.spyOn(quota,'reserve').mockImplementation(async()=>{vi.setSystemTime(base+20000);});
      let calls=0;
      const http=new Transport(quota,async(url,options)=>{calls++;const parsed=new URL(String(url));expect(parsed.searchParams.get('timestamp')).toBe(String(Math.floor((base+20000)/1000)));expect(parsed.searchParams.get('client_id')).toMatch(/^[0-9a-f-]{36}$/);expect(new Headers(options?.headers).get('X-APIKEY')).toBe('unit-test-gmgn');expect(parsed.toString()).not.toContain('unit-test-gmgn');return response({code:0,data:{rank:[{address:'token',name:'Token',symbol:'TOK'}]}});});
      const gmgn=new GmgnProvider(http,{GMGN_API_KEY:'unit-test-gmgn',GMGN_FREE_ACCESS_CONFIRMED:'true'});
      expect((await Promise.all([gmgn.trending('arc'),gmgn.trending('arc')]))[0].tokens).toHaveLength(1);await gmgn.trending('arc');expect(calls).toBe(1);
    }finally{vi.useRealTimers();}
  });
  it('isolates an Alchemy network permission failure from enabled networks on the same account',async()=>{
    const repo=new MemoryRepository(),http=new Transport(new QuotaManager(repo,{}),async url=>String(url).includes('arc-mainnet')?response({},403):response({ok:true}));
    await expect(http.json('alchemy','https://arc-mainnet.g.alchemy.com/v2/unit-test')).rejects.toThrow();expect(await http.json('alchemy','https://base-mainnet.g.alchemy.com/v2/unit-test')).toEqual({ok:true});
    expect((await repo.read()).usage).toHaveLength(1);
  });
  it('coalesces concurrent upstream reads and caches the result',async()=>{const repo=new MemoryRepository();let calls=0;const http=new Transport(new QuotaManager(repo,{}),async()=>{calls++;await new Promise(r=>setTimeout(r,5));return response({ok:true});});await Promise.all(Array.from({length:40},()=>http.json('dexscreener','https://api.example.test',{ttl:1000})));await http.json('dexscreener','https://api.example.test',{ttl:1000});expect(calls).toBe(1);expect((await repo.read()).usage[0].used).toBe(1);});
  it('opens the circuit after 429 and does not retry indefinitely',async()=>{const repo=new MemoryRepository();let calls=0;const http=new Transport(new QuotaManager(repo,{}),async()=>{calls++;return response({},429);});await expect(http.json('helius','https://test.example')).rejects.toThrow();await expect(http.json('helius','https://test.example')).rejects.toThrow();expect(calls).toBe(1);expect((await repo.read()).usage[0].rateLimits).toBe(1);});
  it('rejects malformed JSON and preserves the error in health counters',async()=>{const repo=new MemoryRepository();const http=new Transport(new QuotaManager(repo,{}),async()=>new Response('broken'));await expect(http.json('helius','https://test.example')).rejects.toThrow();expect((await repo.read()).usage[0].errors).toBe(1);});
  it('reserves quota for essential snapshots',async()=>{const repo=new MemoryRepository();const quota=new QuotaManager(repo,{HELIUS_MONTHLY_BUDGET:'100'});await quota.reserve('helius',94,'live');await expect(quota.reserve('helius',2,'live')).rejects.toThrow();await quota.reserve('helius',6,'essential');await expect(quota.reserve('helius',1,'essential')).rejects.toThrow();});
  it('does not treat public RPC on the wrong EVM chain as a valid fallback',async()=>{const repo=new MemoryRepository();const http=new Transport(new QuotaManager(repo,{}),async()=>response({jsonrpc:'2.0',id:1,result:'0x1'}));const rpc=new Rpc('base',{},http);await expect(rpc.call('eth_getBalance',['0x123','latest'])).rejects.toThrow('All configured');});
  it('fails over from Helius to independent public RPC for reads',async()=>{const repo=new MemoryRepository();let calls=0;const http=new Transport(new QuotaManager(repo,{}),async url=>{calls++;return String(url).includes('helius')?response({},503):response({jsonrpc:'2.0',id:1,result:'ok'});});const rpc=new Rpc('solana',{HELIUS_API_KEY:'test-key'},http);expect(await rpc.healthCheck()).toBe(true);expect(calls).toBe(2);});
  it('fails closed for missing transactions',async()=>{const repo=new MemoryRepository();const http=new Transport(new QuotaManager(repo,{}),async()=>response({jsonrpc:'2.0',id:1,result:null}));expect(await new Rpc('solana',{},http).getTransaction('sig')).toBeNull();});
  it('honors a Retry-After value longer than the default cooldown',async()=>{const repo=new MemoryRepository();const now=Date.now();const http=new Transport(new QuotaManager(repo,{}),async()=>new Response('{}',{status:429,headers:{'Retry-After':'300'}}));await expect(http.json('helius','https://example.test')).rejects.toThrow();expect((await repo.read()).usage[0].circuitUntil).toBeGreaterThanOrEqual(now+300000);});
  it('does not let a failed public host disable the backup host',async()=>{const repo=new MemoryRepository();const http=new Transport(new QuotaManager(repo,{}),async url=>String(url).includes('first')?response({},503):response({ok:true}));await expect(http.json('public','https://first.test')).rejects.toThrow();expect(await http.json('public','https://second.test')).toEqual({ok:true});});
  it('does not reset a rolling DexPaprika budget at the calendar-month boundary',async()=>{const repo=new MemoryRepository();await repo.transact(s=>s.controls.push({id:'rolling:dexpaprika:previous-month',value:'45000',expiresAt:Date.now()+100000}));await expect(new QuotaManager(repo,{}).reserve('dexpaprika',1,'essential')).rejects.toThrow('Rolling');});
});
