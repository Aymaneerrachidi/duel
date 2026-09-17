import { z } from 'zod';
import type { Chain, Env } from '../../../../packages/core/src/config.js';
import type { Transport } from './transport.js';
const gmgnChains:Partial<Record<Chain,string>>={solana:'sol',base:'base',bnb:'bsc',ethereum:'eth',robinhood:'robinhood',arc:'arc'};
export class GmgnProvider {
  constructor(private http:Transport,private env:Env){}
  async trending(chain:Chain){
    if(!this.env.GMGN_API_KEY||this.env.GMGN_FREE_ACCESS_CONFIRMED!=='true')return {available:false,reason:'Add your own GMGN key and confirm its free read entitlement in configuration.',tokens:[]};
    const network=gmgnChains[chain];if(!network)return {available:false,reason:'GMGN coverage is not configured for this chain.',tokens:[]};
    const url=`https://openapi.gmgn.ai/v1/market/rank?chain=${network}&interval=1h&limit=10`;
    // GMGN checks a five-second timestamp window. Generate auth after quota pacing,
    // while the unsigned URL remains the stable cache/coalescing key.
    const raw=await this.http.json<unknown>('gmgn',url,{headers:{'X-APIKEY':this.env.GMGN_API_KEY},ttl:300000,priority:'optional',urlAtDispatch:()=>`${url}&timestamp=${Math.floor(Date.now()/1000)}&client_id=${crypto.randomUUID()}`});
    const token=z.object({address:z.string(),symbol:z.string(),name:z.string(),price:z.number().optional(),liquidity:z.number().optional(),price_change_percent:z.number().optional(),volume:z.number().optional()});
    const response=z.object({code:z.number(),data:z.object({code:z.number().optional(),data:z.object({rank:z.array(token)}).optional(),rank:z.array(token).optional()})}).parse(raw);
    if(response.code!==0||response.data.code&&response.data.code!==0)throw new Error('GMGN denied the market request');
    return {available:true,reason:'GMGN market context; not a settlement oracle.',tokens:response.data.data?.rank??response.data.rank??[]};
  }
}
