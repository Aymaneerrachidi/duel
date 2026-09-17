import type { Env } from '../../../../packages/core/src/config.js';
import type { Repository } from '../repository.js';
export class ProviderError extends Error { constructor(readonly provider:string,readonly status:number,message:string){super(message);this.name='ProviderError';} }
export type Priority='essential'|'live'|'optional';
export const MONTHLY_BUDGETS:Record<string,number>={helius:900000,alchemy:27000000,dexscreener:600000,geckoterminal:300000,dexpaprika:45000,jupiter:500000,gmgn:1000,public:500000,defillama:40000};
const RATES:Record<string,number>={helius:6,alchemy:3,dexscreener:3,geckoterminal:0.4,dexpaprika:0.2,jupiter:0.4,gmgn:0.1,public:3,defillama:0.5};
export class QuotaManager {
  constructor(private repo:Repository,private env:Env){}
  async reserve(provider:string,cost:number,priority:Priority,scope=provider){
    const now=Date.now(),month=new Date(now).toISOString().slice(0,7),id=`${provider}-${month}`;
    const delay=await this.repo.transact(s=>{
      let u=s.usage.find(u=>u.id===id);if(!u){u={id,provider,month,used:0,budget:Number(this.env[`${provider.toUpperCase()}_MONTHLY_BUDGET`])||MONTHLY_BUDGETS[provider]||500000,errors:0,rateLimits:0};s.usage.push(u);}
      const health=s.controls.find(c=>c.id===`health:${scope}`);if(health&&health.expiresAt!>now)throw new ProviderError(provider,503,'Provider circuit cooling down');
      const ratio=(u.used+cost)/u.budget;if(ratio>1||ratio>0.95&&priority!=='essential'||ratio>0.85&&priority==='optional')throw new ProviderError(provider,429,'Configured free quota reserved for settlement');
      if(provider==='dexpaprika'){
        const day=new Date(now).toISOString().slice(0,10),prefix='rolling:dexpaprika:';
        const rolling=s.controls.filter(c=>c.id.startsWith(prefix)&&c.expiresAt!>now).reduce((a,c)=>a+Number(c.value),0);
        if(rolling+cost>u.budget)throw new ProviderError(provider,429,'Rolling 30-day free budget reached');
        let daily=s.controls.find(c=>c.id===prefix+day);if(!daily){daily={id:prefix+day,value:'0',expiresAt:now+31*86400000};s.controls.push(daily);}daily.value=String(Number(daily.value)+cost);
      }
      const key=`rate-${provider}`;let rate=s.controls.find(c=>c.id===key);const bucket=Math.floor(now/60000);let value=rate?JSON.parse(rate.value) as {bucket:number;used:number}:{bucket,used:0};if(value.bucket!==bucket)value={bucket,used:0};
      if(value.used>=Math.floor((RATES[provider]??1)*60))throw new ProviderError(provider,429,'Local provider rate budget reached');value.used++;
      if(!rate){rate={id:key,value:''};s.controls.push(rate);}rate.value=JSON.stringify(value);u.used+=cost;
      const paceKey=`pace:${provider}`;let pace=s.controls.find(c=>c.id===paceKey);const scheduled=Math.max(now,Number(pace?.value)||0);
      if(scheduled-now>15000)throw new ProviderError(provider,429,'Provider queue is full');
      if(!pace){pace={id:paceKey,value:'0'};s.controls.push(pace);}pace.value=String(scheduled+Math.max(1000/(RATES[provider]??1),provider==='alchemy'?cost/250*1000:0));
      return scheduled-now;
    });
    if(delay>0)await new Promise(r=>setTimeout(r,delay));
  }
  async record(provider:string,success:boolean,latency:number,status=200,scope=provider,retryAfter=0){await this.repo.transact(s=>{const u=s.usage.find(u=>u.id===`${provider}-${new Date().toISOString().slice(0,7)}`);if(!u)return;u.lastLatency=latency;const key=`health:${scope}`,previous=s.controls.find(c=>c.id===key);s.controls=s.controls.filter(c=>c.id!==key);if(success){u.lastSuccess=Date.now();u.circuitUntil=undefined;}else{u.errors++;if(status===429)u.rateLimits++;u.lastError=`HTTP/RPC ${status}`;const failures=Number(previous?.value??0)+1;const backoff=Math.min(300000,10000*2**Math.min(failures-1,5))*(0.9+Math.random()*0.2);u.circuitUntil=Date.now()+Math.max(retryAfter,status===401||status===403?3600000:status===429?60000:backoff);s.controls.push({id:key,value:String(failures),expiresAt:u.circuitUntil});}});}
}
export class Transport {
  private pending=new Map<string,Promise<unknown>>(); private cache=new Map<string,{value:unknown;expires:number}>();
  constructor(readonly quota:QuotaManager,private fetcher:typeof fetch=fetch){}
  async json<T>(provider:string,url:string,options:{body?:unknown;headers?:Record<string,string>;cost?:number;ttl?:number;priority?:Priority;key?:string;urlAtDispatch?:()=>string}={}):Promise<T>{
    const key=options.key??`${provider}:${url}:${JSON.stringify(options.body??'')}`;const cached=this.cache.get(key);if(cached&&cached.expires>Date.now())return cached.value as T;
    const running=this.pending.get(key);if(running)return running as Promise<T>;
    const job=(async()=>{
      // Public endpoints have independent outages; paid account quotas remain shared.
      const scope=provider==='public'||provider==='alchemy'?`${provider}:${new URL(url).host}`:provider;
      await this.quota.reserve(provider,options.cost??1,options.priority??'live',scope);const start=Date.now();let status=0,retryAfter=0;
      try{
        const response=await this.fetcher(options.urlAtDispatch?.()??url,{method:options.body?'POST':'GET',headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},body:options.body?JSON.stringify(options.body):undefined,signal:AbortSignal.timeout(8000)});status=response.status;
        if(!response.ok){const retry=response.headers.get('retry-after');if(retry){retryAfter=/^\d+$/.test(retry)?Number(retry)*1000:Math.max(0,Date.parse(retry)-Date.now());if(!Number.isFinite(retryAfter))retryAfter=0;}throw new ProviderError(provider,status,'Provider unavailable');}
        const value:unknown=await response.json();if(value&&typeof value==='object'&&'error'in value)throw new ProviderError(provider,502,'RPC returned an error');
        await this.quota.record(provider,true,Date.now()-start,200,scope);
        if(options.ttl){if(this.cache.size>2000)this.cache.clear();this.cache.set(key,{value,expires:Date.now()+options.ttl});}return value as T;
      }catch(error){await this.quota.record(provider,false,Date.now()-start,error instanceof ProviderError?error.status:status||503,scope,retryAfter);if(error instanceof ProviderError)throw error;throw new ProviderError(provider,status||503,'Provider timeout or malformed response');}
    })();this.pending.set(key,job);try{return await job;}finally{this.pending.delete(key);}
  }
}
