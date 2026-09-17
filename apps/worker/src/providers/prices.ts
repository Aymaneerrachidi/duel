import { z } from 'zod';
import { CHAINS, type Chain, type Env } from '../../../../packages/core/src/config.js';
import type { Price } from '../../../../packages/core/src/types.js';
import { selectPool } from '../../../../packages/core/src/pnl.js';
import type { Repository } from '../repository.js';
import { Transport, type Priority } from './transport.js';
const numeric=z.union([z.string(),z.number()]).transform(String).refine(v=>Number.isFinite(Number(v))&&Number(v)>=0);
const pairSchema=z.object({chainId:z.string(),pairAddress:z.string(),baseToken:z.object({address:z.string(),symbol:z.string().default('TOKEN')}),priceUsd:numeric.optional(),liquidity:z.object({usd:z.number().nonnegative().optional()}).optional(),volume:z.object({h24:z.number().nonnegative().optional()}).optional(),pairCreatedAt:z.number().optional(),priceChange:z.object({h24:z.number().optional()}).optional(),info:z.object({imageUrl:z.string().optional()}).optional()});
export interface PriceProvider { getTokenPrices(chain:Chain,addresses:string[],priority?:Priority):Promise<Map<string,Price>>; getTokenPrice(chain:Chain,address:string):Promise<Price|null>; getNativePrice(chain:Chain):Promise<Price|null> }
export const tokenKey=(chain:Chain,address:string)=>chain==='solana'?address:address.toLowerCase();
export class Prices implements PriceProvider {
  constructor(private http:Transport,private repo:Repository,private env:Env){}
  async getTokenPrice(chain:Chain,address:string){return (await this.getTokenPrices(chain,[address])).get(tokenKey(chain,address))??null;}
  async getNativePrice(chain:Chain){if(chain==='robinhood'||chain==='arc'){const address=chain==='arc'?'0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48':CHAINS.ethereum.native;const p=await this.getTokenPrice('ethereum',address);return p?{...p,chain,address:CHAINS[chain].native,referenceChain:'ethereum' as const,referenceAddress:address,symbol:CHAINS[chain].symbol,confidence:'MEDIUM' as const,source:`${p.source}; canonical ${CHAINS[chain].symbol} reference on Ethereum`}:null;}return this.getTokenPrice(chain,CHAINS[chain].native);}
  async getTokenPrices(chain:Chain,addresses:string[],priority:Priority='live'){
    const result=new Map<string,Price>();const now=Date.now();const unique=[...new Set(addresses.filter(Boolean).map(a=>tokenKey(chain,a)))];
    const stored=(await this.repo.read()).prices;
    for(const address of unique){const p=stored.find(p=>p.chain===chain&&tokenKey(chain,p.address)===address);if(p&&now-p.timestamp<45000)result.set(address,p);}
    const missing=unique.filter(a=>!result.has(a));
    for(let n=0;n<missing.length;n+=30){const batch=missing.slice(n,n+30);try{
      const raw=await this.http.json<unknown>('dexscreener',`https://api.dexscreener.com/tokens/v1/${CHAINS[chain].dex}/${batch.join(',')}`,{ttl:45000,priority});const pairs=z.array(pairSchema).parse(raw);
      for(const address of batch){const selected=selectPool(pairs.filter(p=>p.chainId===CHAINS[chain].dex&&tokenKey(chain,p.baseToken.address)===address&&p.priceUsd).map(p=>({chain,address,symbol:p.baseToken.symbol,usd:p.priceUsd!,liquidity:String(p.liquidity?.usd??0),volume24h:String(p.volume?.h24??0),source:'DEX Screener',pool:p.pairAddress,timestamp:now,observedAt:now,poolCreatedAt:p.pairCreatedAt,confidence:'HIGH',divergence:0,change24h:p.priceChange?.h24,image:p.info?.imageUrl})));if(selected)result.set(address,selected);}
    }catch{/* Continue to an independent read provider; never substitute demo data. */}}
    for(const address of missing.filter(a=>!result.has(a)).slice(0,12)){
      const price=await this.gecko(chain,address,priority).catch(()=>null)??await this.paprika(chain,address,priority).catch(()=>null);
      if(price)result.set(address,price);
    }
    // Jupiter is a cross-check and a price fallback only when liquidity evidence exists.
    if(chain==='solana'&&missing.length){try{
      const ids=missing.slice(0,50);const raw=await this.http.json<unknown>('jupiter',`https://api.jup.ag/price/v3?ids=${ids.join(',')}`,{headers:this.env.JUPITER_API_KEY?{'x-api-key':this.env.JUPITER_API_KEY}:{},ttl:45000,priority});
      const quotes=z.record(z.string(),z.object({usdPrice:z.number().nonnegative(),createdAt:z.string().optional()})).parse(raw);
      for(const [address,q] of Object.entries(quotes)){const p=result.get(address);if(p&&Number(p.usd)>0){const divergence=Math.abs(q.usdPrice-Number(p.usd))/Number(p.usd);p.divergence=Math.max(p.divergence,divergence);if(divergence>0.2)p.confidence='LOW';}}
    }catch{/* A missing cross-check does not invent a second price. */}}
    if(result.size)await this.repo.transact(s=>{for(const p of result.values()){const id=`${p.chain}:${tokenKey(p.chain,p.address)}`;const index=s.prices.findIndex(v=>v.id===id);if(index>=0){const previous=s.prices[index],history=[{...previous,history:undefined},...previous.history??[]].map(value=>value as Price).filter(q=>q.timestamp<p.timestamp&&p.timestamp-q.timestamp<=1800000).slice(0,40);s.prices[index]={...p,id,history};}else s.prices.push({...p,id,history:[]});}});
    return result;
  }
  private async gecko(chain:Chain,address:string,priority:Priority):Promise<Price|null>{
    const raw=await this.http.json<unknown>('geckoterminal',`https://api.geckoterminal.com/api/v2/networks/${CHAINS[chain].gecko}/tokens/${address}/pools?page=1`,{ttl:45000,priority});
    const schema=z.object({data:z.array(z.object({attributes:z.object({address:z.string(),name:z.string(),base_token_price_usd:numeric,quote_token_price_usd:numeric.optional(),reserve_in_usd:numeric,volume_usd:z.object({h24:numeric}),pool_created_at:z.string().optional()}),relationships:z.object({base_token:z.object({data:z.object({id:z.string()})})})}))});
    const now=Date.now();return selectPool(schema.parse(raw).data.filter(p=>tokenKey(chain,p.relationships.base_token.data.id.replace(`${CHAINS[chain].gecko}_`,''))===tokenKey(chain,address)).map(p=>({chain,address,symbol:p.attributes.name.split(' / ')[0],usd:p.attributes.base_token_price_usd,liquidity:p.attributes.reserve_in_usd,volume24h:p.attributes.volume_usd.h24,source:'GeckoTerminal',pool:p.attributes.address,timestamp:now,observedAt:now,poolCreatedAt:p.attributes.pool_created_at?Date.parse(p.attributes.pool_created_at):undefined,confidence:'MEDIUM',divergence:0})));
  }
  private async paprika(chain:Chain,address:string,priority:Priority):Promise<Price|null>{
    const raw=await this.http.json<unknown>('dexpaprika',`https://api.dexpaprika.com/networks/${CHAINS[chain].dex}/tokens/${address}`,{headers:this.env.DEXPAPRIKA_API_KEY?{Authorization:this.env.DEXPAPRIKA_API_KEY}:{},ttl:60000,priority});
    const p=z.object({id:z.string(),symbol:z.string(),summary:z.object({price_usd:z.number().nonnegative(),liquidity_usd:z.number().nonnegative(),'24h':z.object({volume_usd:z.number().nonnegative()})})}).parse(raw);const now=Date.now();
    if(tokenKey(chain,p.id)!==tokenKey(chain,address))return null;
    return {chain,address,symbol:p.symbol,usd:String(p.summary.price_usd),liquidity:String(p.summary.liquidity_usd),volume24h:String(p.summary['24h'].volume_usd),source:'DexPaprika aggregate (up to 60s delay)',pool:'provider-aggregate',timestamp:now-60000,observedAt:now,confidence:'MEDIUM',divergence:0};
  }
}
