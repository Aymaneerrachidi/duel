import type { Chain } from '@shared/config';
import type { CashFlow, DuelEvent, DuelView, IndexedTransaction, Prediction, Profile, Snapshot, Stats } from '@shared/types';
export interface Bootstrap {product:{name:string};mode:'demo'|'live';serverTime:number;chains:Chain[];profile?:Profile;points:number|null;admin:boolean;duels:DuelView[];traders:(Profile&{stats:Stats})[];events:DuelEvent[];rules:{predictionCutoffFraction:number}}
export interface DuelDetail {duel:DuelView;snapshots:Snapshot[];flows:CashFlow[];transactions:IndexedTransaction[];events:DuelEvent[];predictions:Prediction[];serverTime:number}
export async function api<T>(path:string,options:{method?:string;body?:unknown;idempotency?:string}={}):Promise<T>{
  const response=await fetch(`/api${path}`,{credentials:'same-origin',method:options.method??'GET',headers:{'Content-Type':'application/json','X-Duels-Request':'1',...(options.idempotency?{'Idempotency-Key':options.idempotency}:{})},body:options.body===undefined?undefined:JSON.stringify(options.body)});
  const data:unknown=await response.json();if(!response.ok)throw new Error(data&&typeof data==='object'&&'error'in data?String(data.error):'Request failed. Try again.');return data as T;
}
export const nameOf=(p:Profile)=>p.username||`${p.wallet.slice(0,4)}…${p.wallet.slice(-4)}`;
export const short=(s:string)=>s.length>16?`${s.slice(0,5)}…${s.slice(-4)}`:s;
export const pct=(n:number|undefined)=>n===undefined?'—':`${n>=0?'+':''}${n.toFixed(2)}%`;
export const money=(n:string|number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(n));
export const compact=(n:number)=>new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(n);
export const age=(timestamp:number)=>{const seconds=Math.max(0,Math.floor((Date.now()-timestamp)/1000));return seconds<60?`${seconds}s ago`:seconds<3600?`${Math.floor(seconds/60)}m ago`:seconds<86400?`${Math.floor(seconds/3600)}h ago`:`${Math.floor(seconds/86400)}d ago`;};
