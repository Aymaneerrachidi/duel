import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../../../packages/core/src/config.js';
import { emptyState, TABLE_NAMES, type State, type Table } from '../../../packages/core/src/types.js';
export interface Repository { read():Promise<State>; transact<T>(fn:(state:State)=>T|Promise<T>):Promise<T>; rateLimit(key:string,limit:number,expiresAt:number):Promise<boolean> }
export class MemoryRepository implements Repository {
  protected state:State; private queue:Promise<unknown>=Promise.resolve();
  constructor(state=emptyState()){this.state=state;}
  async read(){await this.queue;return structuredClone(this.state);}
  protected async persist(_state:State){}
  rateLimit(key:string,limit:number,expiresAt:number){return this.transact(s=>{const count=s.controls.find(v=>v.id===key);if(count&&Number(count.value)>=limit)return false;if(count)count.value=String(Number(count.value)+1);else s.controls.push({id:key,value:'1',expiresAt});return true;});}
  transact<T>(fn:(state:State)=>T|Promise<T>):Promise<T>{const task=this.queue.then(async()=>{const draft=structuredClone(this.state);const result=await fn(draft);await this.persist(draft);this.state=draft;return result;});this.queue=task.catch(()=>undefined);return task;}
}
export class SupabaseRepository implements Repository {
  readonly client:SupabaseClient;
  private cached?:{state:State;expires:number};
  private pending?:Promise<{revision:number;state:State}>;
  constructor(env:Env){if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Set Supabase server credentials');this.client=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});}
  private async load(){const {data,error}=await this.client.rpc('duels_read_state');if(error)throw new Error(`Database read failed: ${error.code}`);return data as {revision:number;state:State};}
  async read(){if(this.cached&&this.cached.expires>Date.now())return structuredClone(this.cached.state);this.pending??=this.load();try{const result=await this.pending;this.cached={state:result.state,expires:Date.now()+5000};return structuredClone(result.state);}finally{this.pending=undefined;}}
  async rateLimit(key:string,limit:number,expiresAt:number){const {data,error}=await this.client.rpc('duels_rate_limit',{counter_key:key,counter_limit:limit,expires_at_ms:expiresAt});if(error)throw new Error('Rate limit service unavailable');return data===true;}
  async transact<T>(fn:(state:State)=>T|Promise<T>):Promise<T>{
    for(let attempt=0;attempt<5;attempt++){
      const {revision,state}=await this.load();const draft=structuredClone(state);const result=await fn(draft);const changes:{table:Table;id:string;data:unknown|null}[]=[];
      for(const table of TABLE_NAMES){const prev=new Map(state[table].map(row=>[row.id,JSON.stringify(row)]));for(const row of draft[table]){if(prev.get(row.id)!==JSON.stringify(row))changes.push({table,id:row.id,data:row});prev.delete(row.id);}for(const id of prev.keys())changes.push({table,id,data:null});}
      if(!changes.length)return result;
      const {data,error}=await this.client.rpc('duels_commit',{expected_revision:revision,changes});
      if(error)throw new Error(`Database commit failed: ${error.code}`);if(data===true){this.cached=undefined;return result;}
    }
    throw new Error('Concurrent update; retry the request');
  }
}
