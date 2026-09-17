export const PRODUCT = { name: 'PNL DUELS', tagline: 'Let your portfolio do the talking.', version: '0.1.0' } as const;
export const CHAIN_IDS = ['solana', 'robinhood', 'base', 'bnb', 'ethereum', 'arc'] as const;
export type Chain = typeof CHAIN_IDS[number];
export const CHAINS = {
  solana: { name: 'Solana', symbol: 'SOL', decimals: 9, id: 0, color: '#ae91f5', explorer: 'https://solscan.io', rpc: 'https://api.mainnet-beta.solana.com', backup: 'https://solana-rpc.publicnode.com', dex: 'solana', gecko: 'solana', native: 'So11111111111111111111111111111111111111112', alchemy: 'solana-mainnet', confirmations: 32 },
  robinhood: { name: 'Robinhood', symbol: 'ETH', decimals: 18, id: 4663, color: '#c3f64b', explorer: 'https://robinhoodchain.blockscout.com', rpc: 'https://rpc.mainnet.chain.robinhood.com', backup: 'https://robinhood-rpc.publicnode.com', dex: 'robinhood', gecko: 'robinhood', native: '', alchemy: 'robinhood-mainnet', confirmations: 64 },
  base: { name: 'Base', symbol: 'ETH', decimals: 18, id: 8453, color: '#638bff', explorer: 'https://basescan.org', rpc: 'https://mainnet.base.org', backup: 'https://base-rpc.publicnode.com', dex: 'base', gecko: 'base', native: '0x4200000000000000000000000000000000000006', alchemy: 'base-mainnet', confirmations: 20 },
  bnb: { name: 'BNB Chain', symbol: 'BNB', decimals: 18, id: 56, color: '#efc84a', explorer: 'https://bscscan.com', rpc: 'https://bsc-dataseed.bnbchain.org', backup: 'https://bsc-rpc.publicnode.com', dex: 'bsc', gecko: 'bsc', native: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', alchemy: 'bnb-mainnet', confirmations: 15 },
  ethereum: { name: 'Ethereum', symbol: 'ETH', decimals: 18, id: 1, color: '#96a1cb', explorer: 'https://etherscan.io', rpc: 'https://ethereum-rpc.publicnode.com', backup: 'https://eth.drpc.org', dex: 'ethereum', gecko: 'eth', native: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', alchemy: 'eth-mainnet', confirmations: 64 },
  arc: { name: 'Arc', symbol: 'USDC', decimals: 18, id: 5042, color: '#7bdce4', explorer: 'https://explorer.arc.io', rpc: 'https://rpc.mainnet.arc.io', backup: 'https://rpc.drpc.mainnet.arc.io', dex: 'arc', gecko: 'arc', native: '0x3600000000000000000000000000000000000000', alchemy: 'arc-mainnet', confirmations: 1 },
} as const;
export const RULES = Object.freeze({ version: 'twr-v1', minimumStartUsd: 10, minimumPositionUsd: 1, minimumLiquidityUsd: 10000, minimumPoolAgeSeconds: 3600, maxPriceAgeSeconds: 120, maxCrossPoolDivergence: 0.2, maxPositionToLiquidity: 0.25, fullValueRatio: 0.02, mediumRatio: 0.10, tiePercentagePoints: 0.05, endToleranceSeconds: 300, challengeExpirySeconds: 86400, predictionCutoffFraction: 0.8, initialPoints: 10000 });
export type Env = Record<string, string | undefined>;
export function isDemo(env: Env) { return env.DEMO_MODE !== 'false'; }
export function enabledChains(env: Env) { return CHAIN_IDS.filter(c => env[`FEATURE_${c.toUpperCase()}`] !== 'false'); }
export function enforceSafety(env: Env) {
  if (env.REAL_MONEY_ENABLED === 'true' || env.REAL_MONEY_SPECTATOR_MARKETS === 'true') throw new Error('This beta does not enable mainnet wagering. Use simulated stakes.');
  if (env.ALLOW_PAID_PROVIDER_USAGE === 'true') throw new Error('Paid provider usage is not supported by this free-first deployment.');
  if (env.ESCROW_MODE && env.ESCROW_MODE !== 'simulated') throw new Error('The web beta currently uses simulated stakes. Contract deployments are separate and never auto-enabled.');
  if (!isDemo(env) && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)) throw new Error('Live mode requires SESSION_SECRET of at least 32 characters.');
}
