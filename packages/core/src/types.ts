import type { Chain } from './config.js';
export type Status = 'OPEN' | 'AWAITING_DEPOSIT' | 'ACTIVE' | 'CALCULATING' | 'FINALIZING' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';
export type Quality = 'HIGH' | 'MEDIUM' | 'LOW' | 'INCOMPLETE';
export type WalletFamily = 'solana' | 'evm';
export interface LinkedWallet { family: WalletFamily; address: string; verifiedAt: number }
export interface Profile { id: string; wallet: string; chain: Chain; wallets?: LinkedWallet[]; username: string; createdAt: number; usernameChangedAt?: number; following: string[]; demo: boolean }
export interface Duel { id: string; slug: string; chain: Chain; chains?: Chain[]; portfolioWallets?: Record<string, LinkedWallet[]>; challenger: string; opponent: string; stake: string; duration: number; createdAt: number; expiresAt: number; startsAt?: number; endsAt?: number; status: Status; visibility: 'PUBLIC' | 'UNLISTED'; rulesVersion: string; demo: boolean; challengerReturn?: number; opponentReturn?: number; winner?: string | null; resultHash?: string; quality: Quality; issues: string[]; lastUpdated?: number; nextUpdate?: number; predictionSettled?: boolean; views: number; escrowMode: 'simulated'; finalityProofs?: FinalityProof[]; }
export interface FinalityProof { chain: Chain; block: string; blockHash: string; checkedAt: number }
export interface Price { chain: Chain; address: string; symbol: string; usd: string; liquidity: string; volume24h: string; source: string; pool: string; timestamp: number; observedAt: number; poolCreatedAt?: number; confidence: Quality; divergence: number; change24h?: number; image?: string; referenceChain?: Chain; referenceAddress?: string }
export interface Position { address: string; chain?: Chain; symbol: string; balance: string; rawBalance: string; decimals: number; price: Price | null; valueUsd: string; excludedUsd: string; reason?: string }
export interface Snapshot { id: string; duelId: string; wallet: string; chain: Chain; timestamp: number; block: string; blockHash?: string; finality?: 'pending' | 'finalized'; components?: Snapshot[]; totalUsd: string; positions: Position[]; quality: Quality; issues: string[]; rulesVersion: string; returnPct?: number; lastSignature?: string; tokenAccounts?: string[]; transactionCoverage: boolean }
export interface CashFlow { id: string; duelId: string; wallet: string; txHash: string; timestamp: number; amountUsd: string; beforeValueUsd: string; afterValueUsd: string; classification: 'INFLOW' | 'OUTFLOW' | 'CLASSIFICATION_PENDING'; reason: string }
export interface IndexedTransaction { id: string; duelId: string; wallet: string; chain: Chain; hash: string; timestamp: number; block: string; classification: 'SWAP' | 'TRANSFER' | 'FEE' | 'CLASSIFICATION_PENDING'; reason: string; blockHash?: string }
export interface Prediction { id: string; duelId: string; profileId: string; side: string; points: number; createdAt: number; payout?: number }
export interface Ledger { id: string; profileId: string; delta: number; reason: string; duelId?: string; createdAt: number }
export interface DuelEvent { id: string; duelId: string; type: string; text: string; createdAt: number; wallet?: string }
export interface Nonce { id: string; wallet: string; chain: Chain; message: string; expiresAt: number; purpose?: 'login' | 'link'; profileId?: string; sessionId?: string }
export interface Session { id: string; profileId: string; expiresAt: number; demo: boolean }
export interface ProviderUsage { id: string; provider: string; month: string; used: number; budget: number; errors: number; rateLimits: number; lastSuccess?: number; lastError?: string; lastLatency?: number; circuitUntil?: number }
export interface Control { id: string; value: string; expiresAt?: number }
export interface Audit { id: string; actor: string; action: string; createdAt: number }
export interface Tables { profiles: Profile; duels: Duel; snapshots: Snapshot; cashflows: CashFlow; transactions: IndexedTransaction; predictions: Prediction; ledger: Ledger; events: DuelEvent; nonces: Nonce; sessions: Session; usage: ProviderUsage; controls: Control; audit: Audit; prices: Price & {id: string; history?: Price[]} }
export type Table = keyof Tables;
export type State = { [K in Table]: Tables[K][] };
export interface Stats { wins: number; losses: number; ties: number; total: number; winRate: number; averageReturn: number; bestReturn: number; worstReturn: number; streak: number; longestStreak: number; won: number; staked: number }
export interface DuelView extends Duel { challengerProfile: Profile; opponentProfile: Profile; challengerStats: Stats; opponentStats: Stats; backing: [number, number]; predictionCount: number }
export const TABLE_NAMES: Table[] = ['profiles','duels','snapshots','cashflows','transactions','predictions','ledger','events','nonces','sessions','usage','controls','audit','prices'];
export const emptyState = (): State => Object.fromEntries(TABLE_NAMES.map(t => [t, []])) as unknown as State;
