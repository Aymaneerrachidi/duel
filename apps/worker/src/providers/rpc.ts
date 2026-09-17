import { z } from 'zod';
import Decimal from 'decimal.js';
import { CHAINS, type Chain, type Env } from '../../../../packages/core/src/config.js';
import { ProviderError, Transport, type Priority } from './transport.js';
export interface Balance { address:string;raw:string;decimals:number;balance:string;symbol:string;account?:string }
export interface WalletBalances { block:string;blockHash?:string;timestamp:number;native:Balance;tokens:Balance[];issues:string[] }
export interface SolanaProvider { getNativeBalance(wallet:string):Promise<unknown>; getTokenBalances(wallet:string):Promise<unknown>; getRecentSignatures(wallet:string,since:number):Promise<Signature[]>; getTransactions(signatures:string[]):Promise<unknown[]>; getBlockTime(slot:number):Promise<number>; healthCheck():Promise<boolean> }
export interface EvmProvider { getNativeBalance(wallet:string,block?:string):Promise<unknown>;getTokenBalances(wallet:string):Promise<unknown>;getTokenTransfers(wallet:string,fromBlock:string,toBlock:string):Promise<unknown[]>;getTransaction(hash:string):Promise<unknown>;getReceipt(hash:string):Promise<unknown>;getBlock(block:string):Promise<unknown>;healthCheck():Promise<boolean> }
type Endpoint={url:string;provider:string};
export interface Signature {signature:string;slot:number;blockTime:number|null;err:unknown}
const rpcEnvelope=z.object({jsonrpc:z.literal('2.0'),id:z.union([z.number(),z.string()]),result:z.unknown()});
export class Rpc {
  readonly endpoints:Endpoint[];
  constructor(readonly chain:Chain,private env:Env,private http:Transport){
    const custom=env[`${chain.toUpperCase()}_RPC_URL`];this.endpoints=[];
    if(custom)this.endpoints.push({url:custom,provider:custom.includes('helius')?'helius':custom.includes('alchemy')?'alchemy':'public'});
    if(chain==='solana'&&env.HELIUS_API_KEY)this.endpoints.push({url:`https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`,provider:'helius'});
    if(env.ALCHEMY_API_KEY)this.endpoints.push({url:`https://${CHAINS[chain].alchemy}.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`,provider:'alchemy'});
    if(chain==='solana'&&env.SOLANA_BACKUP_RPC_URL)this.endpoints.push({url:env.SOLANA_BACKUP_RPC_URL,provider:'public'});
    if(chain!=='solana')for(const url of (env.EVM_BACKUP_RPC_URLS??'').split(',').map(u=>u.trim()).filter(Boolean))this.endpoints.push({url,provider:'public'});
    this.endpoints.push({url:CHAINS[chain].rpc,provider:'public'},{url:CHAINS[chain].backup,provider:'public'});
  }
  async call<T>(method:string,params:unknown[]=[],priority:Priority='live',onlyProvider?:string):Promise<T>{
    for(const endpoint of this.endpoints.filter(e=>!onlyProvider||e.provider===onlyProvider)){
      try{
        if(this.chain!=='solana'&&method!=='eth_chainId'){
          const network=await this.http.json<unknown>(endpoint.provider,endpoint.url,{body:{jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]},cost:endpoint.provider==='alchemy'?10:1,ttl:86400000,priority});
          if(Number(rpcEnvelope.parse(network).result)!==CHAINS[this.chain].id)throw new ProviderError(endpoint.provider,400,'RPC chain mismatch');
        }
        const response=await this.http.json<unknown>(endpoint.provider,endpoint.url,{body:{jsonrpc:'2.0',id:1,method,params},cost:endpoint.provider==='alchemy'?(method.startsWith('alchemy_')?150:30):1,ttl:method==='getTransaction'||method==='eth_getTransactionReceipt'?3600000:5000,priority});
        return rpcEnvelope.parse(response).result as T;
      }catch{/* Read-only failover. Never broadcast transactions here. */}
    }
    throw new ProviderError(this.chain,503,`All configured ${this.chain} providers failed for ${method}`);
  }
  async healthCheck(){return this.chain==='solana'?await this.call<string>('getHealth')==='ok':Number(await this.call<string>('eth_chainId'))===CHAINS[this.chain].id;}
  getNativeBalance(wallet:string,block='latest'){return this.chain==='solana'?this.call('getBalance',[wallet,{commitment:'finalized'}]):this.call('eth_getBalance',[wallet,block]);}
  getTokenBalances(wallet:string){return this.chain==='solana'?this.call('getTokenAccountsByOwner',[wallet,{programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'},{encoding:'jsonParsed',commitment:'finalized'}]):this.call('alchemy_getTokenBalances',[wallet,'erc20'],'live','alchemy');}
  getBlockTime(slot:number){return this.call<number>('getBlockTime',[slot]);}
  getTransaction(hash:string){return this.chain==='solana'?this.call('getTransaction',[hash,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}]):this.call('eth_getTransactionByHash',[hash]);}
  getReceipt(hash:string){return this.call('eth_getTransactionReceipt',[hash]);}
  getBlock(block:string){return this.call('eth_getBlockByNumber',[block,false]);}
  async getTransactions(signatures:string[]){const results:unknown[]=[];for(let i=0;i<signatures.length;i+=3)results.push(...await Promise.all(signatures.slice(i,i+3).map(s=>this.getTransaction(s))));return results;}
  async getRecentSignatures(wallet:string,since:number,minSlot?:number):Promise<Signature[]>{
    const all:Signature[]=[];let before:string|undefined;
    for(let page=0;page<10;page++){
      const entries=z.array(z.object({signature:z.string(),slot:z.number(),blockTime:z.number().nullable(),err:z.unknown()})).parse(await this.call('getSignaturesForAddress',[wallet,{limit:100,before,commitment:'finalized'}]));
      for(const e of entries)if(minSlot!==undefined?e.slot>minSlot:e.blockTime===null||e.blockTime*1000>=since)all.push(e);
      if(entries.length<100||entries.some(e=>minSlot!==undefined?e.slot<=minSlot:e.blockTime!==null&&e.blockTime*1000<since))return all;
      before=entries.at(-1)!.signature;
    }
    throw new ProviderError(this.chain,413,'Incremental history exceeds this beta batch; reconciliation required');
  }
  async signatureOrder(slot:number){return z.object({signatures:z.array(z.string())}).parse(await this.call('getBlock',[slot,{commitment:'finalized',transactionDetails:'signatures',rewards:false,maxSupportedTransactionVersion:0}],'essential')).signatures;}
  async getTokenTransfers(wallet:string,fromBlock:string,toBlock:string):Promise<unknown[]>{
    const all:unknown[]=[];
    for(const direction of ['fromAddress','toAddress']){let pageKey:string|undefined;for(let page=0;page<10;page++){
      const response=z.object({transfers:z.array(z.unknown()),pageKey:z.string().optional()}).parse(await this.call('alchemy_getAssetTransfers',[{[direction]:wallet,fromBlock,toBlock,category:this.chain==='ethereum'||this.chain==='base'?['external','internal','erc20']:['external','erc20'],withMetadata:true,excludeZeroValue:false,maxCount:'0x64',pageKey}],'essential','alchemy'));
      all.push(...response.transfers);pageKey=response.pageKey;if(!pageKey)break;if(page===9)throw new Error('Transfer pagination incomplete');
    }}return all;
  }
  async balances(wallet:string,priority:Priority='live',finality:'latest'|'finalized'='finalized'):Promise<WalletBalances>{
    if(this.chain==='solana'){
      const native=z.object({context:z.object({slot:z.number()}),value:z.number().int().nonnegative()}).parse(await this.call('getBalance',[wallet,{commitment:'finalized'}],priority));
      const tokens:Balance[]=[];const issues:string[]=[];
      for(const programId of ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']){
        const parsed=z.object({context:z.object({slot:z.number()}),value:z.array(z.object({pubkey:z.string(),account:z.object({data:z.object({parsed:z.object({info:z.object({mint:z.string(),tokenAmount:z.object({amount:z.string(),decimals:z.number()}),extensions:z.array(z.unknown()).optional()})})})})}))}).parse(await this.call('getTokenAccountsByOwner',[wallet,{programId},{encoding:'jsonParsed',commitment:'finalized',minContextSlot:native.context.slot}],priority));
        if(parsed.context.slot-native.context.slot>32)issues.push('Balance reads span more than 32 slots');
        for(const item of parsed.value){const info=item.account.data.parsed.info;if(info.tokenAmount.amount==='0')continue;if(info.extensions?.length)issues.push('Token-2022 extensions need valuation review');tokens.push({address:info.mint,raw:info.tokenAmount.amount,decimals:info.tokenAmount.decimals,balance:new Decimal(info.tokenAmount.amount).div(new Decimal(10).pow(info.tokenAmount.decimals)).toString(),symbol:info.mint.slice(0,6),account:item.pubkey});}
      }
      if(tokens.length>24)throw new ProviderError('solana',413,'This beta supports at most 24 nonzero token accounts per wallet');
      // Re-read native and discovered token accounts together at one finalized slot.
      const accountSchema=z.object({lamports:z.number().int().nonnegative(),owner:z.string(),data:z.unknown()}).nullable();
      const atomic=z.object({context:z.object({slot:z.number()}),value:z.array(accountSchema)}).parse(await this.call('getMultipleAccounts',[[wallet,...tokens.map(t=>t.account)],{encoding:'jsonParsed',commitment:'finalized',minContextSlot:native.context.slot}],priority));
      if(atomic.value.length!==tokens.length+1)throw new Error('Incomplete atomic balance response');
      if(atomic.value[0]&&atomic.value[0].owner!=='11111111111111111111111111111111')issues.push('Only ordinary system-owned Solana wallets are supported');
      const finalTokens:Balance[]=[];
      for(let i=0;i<tokens.length;i++){
        const account=atomic.value[i+1];if(!account){issues.push('Token account changed during discovery');continue;}
        const info=z.object({parsed:z.object({info:z.object({mint:z.string(),owner:z.string(),tokenAmount:z.object({amount:z.string(),decimals:z.number()})})})}).parse(account.data).parsed.info;
        if(info.owner!==wallet||info.mint!==tokens[i].address)throw new Error('Token ownership changed during discovery');
        finalTokens.push({...tokens[i],raw:info.tokenAmount.amount,balance:new Decimal(info.tokenAmount.amount).div(new Decimal(10).pow(info.tokenAmount.decimals)).toString()});
      }
      const recent=z.array(z.object({slot:z.number()})).parse(await this.call('getSignaturesForAddress',[wallet,{limit:1,commitment:'finalized'}],priority));
      if(recent.some(t=>t.slot>native.context.slot))issues.push('Wallet activity overlapped account discovery; retry after the wallet is idle');
      const lamports=atomic.value[0]?.lamports??0;if(!Number.isSafeInteger(lamports))issues.push('Native balance exceeds safe RPC numeric precision');
      const timestamp=await this.getBlockTime(atomic.context.slot);return {block:String(atomic.context.slot),timestamp:timestamp*1000,native:{address:CHAINS.solana.native,raw:String(lamports),decimals:9,balance:new Decimal(lamports).div(1e9).toString(),symbol:'SOL'},tokens:finalTokens,issues};
    }
    const block=z.object({number:z.string(),hash:z.string(),timestamp:z.string()}).parse(await this.getBlock(finality));
    const raw=z.string().parse(await this.call('eth_getBalance',[wallet,block.number],priority));const tokens:Balance[]=[];const issues:string[]=[];
    try{
      let pageKey:string|undefined;let pages=0;
      do{
        const data=z.object({tokenBalances:z.array(z.object({contractAddress:z.string(),tokenBalance:z.string().nullable(),error:z.string().optional()})),pageKey:z.string().optional()}).parse(await this.call('alchemy_getTokenBalances',[wallet,'erc20',...(pageKey?[{pageKey}]:[])],priority,'alchemy'));
        for(const token of data.tokenBalances){if(token.error){issues.push('Token balance query failed');continue;}if(!token.tokenBalance)continue;
          if(this.chain==='arc'&&token.contractAddress.toLowerCase()===CHAINS.arc.native.toLowerCase())continue;
          const [balance,decimalsRaw]=await Promise.all([this.call<string>('eth_call',[{to:token.contractAddress,data:`0x70a08231${wallet.slice(2).padStart(64,'0')}`},block.number],priority),this.call<string>('eth_call',[{to:token.contractAddress,data:'0x313ce567'},block.number],priority)]);
          const decimals=Number(BigInt(decimalsRaw));if(decimals>36)throw new Error('Unsupported token decimals');if(BigInt(balance)===0n)continue;tokens.push({address:token.contractAddress,raw:BigInt(balance).toString(),decimals,balance:new Decimal(BigInt(balance).toString()).div(new Decimal(10).pow(decimals)).toString(),symbol:token.contractAddress.slice(0,6)});
          if(tokens.length>40)throw new Error('Wallet exceeds beta token limit');
        }pageKey=data.pageKey;pages++;if(pageKey&&pages>=5)throw new Error('Token discovery pagination incomplete');
      }while(pageKey);
    }catch{issues.push('Complete ERC-20 discovery unavailable; native balance alone is not a complete portfolio');}
    return {block:block.number,blockHash:block.hash,timestamp:Number(BigInt(block.timestamp))*1000,native:{address:CHAINS[this.chain].native,raw:BigInt(raw).toString(),decimals:18,balance:new Decimal(BigInt(raw).toString()).div('1e18').toString(),symbol:CHAINS[this.chain].symbol},tokens,issues};
  }
}
