import Decimal from 'decimal.js';
import { CHAINS, RULES, type Chain } from './config.js';
import type { Duel, LinkedWallet, Profile, Snapshot, WalletFamily } from './types.js';

export const PORTFOLIO_RULES_VERSION = 'twr-portfolio-v1';
export const walletFamily = (chain: Chain): WalletFamily => chain === 'solana' ? 'solana' : 'evm';
export const walletKey = (family: WalletFamily, address: string) => `${family}:${family === 'evm' ? address.toLowerCase() : address}`;
export function linkedWallets(profile: Profile): LinkedWallet[] {
  return profile.wallets ?? (profile.demo ? [{ family: walletFamily(profile.chain), address: profile.wallet, verifiedAt: profile.createdAt }] : []);
}
export function ownsAddress(profile: Profile, chain: Chain, address: string) {
  const key = walletKey(walletFamily(chain), address);
  return walletKey(walletFamily(profile.chain), profile.wallet) === key || linkedWallets(profile).some(w => walletKey(w.family, w.address) === key);
}
export const duelChains = (duel: Pick<Duel, 'chain' | 'chains'>) => duel.chains ?? [duel.chain];
export const duelStakeSymbol = (duel: Pick<Duel, 'chain' | 'chains'>) => duel.chains ? 'USD' : CHAINS[duel.chain].symbol;
export const duelChainLabel = (duel: Pick<Duel, 'chain' | 'chains'>) => duel.chains ? `${duel.chains.length} chains` : CHAINS[duel.chain].name;
export function portfolioAddress(duel: Duel, profile: Profile, chain: Chain) {
  if (!duel.chains) return profile.wallet;
  return (duel.portfolioWallets?.[profile.id] ?? linkedWallets(profile)).find(w => w.family === walletFamily(chain))?.address;
}

export function combineSnapshots(duel: Duel, profile: Profile, components: Snapshot[]): Snapshot {
  const chains = duelChains(duel);
  const issues = components.flatMap(s => s.issues.map(issue => `${CHAINS[s.chain].name}: ${issue}`));
  if (components.length !== chains.length || chains.some(chain => components.filter(s => s.chain === chain).length !== 1)) issues.push('Every portfolio chain needs exactly one snapshot');
  if (components.some(s => s.wallet !== profile.id || s.duelId !== duel.id || s.components)) issues.push('Portfolio component identity mismatch');
  const timestamps = components.map(s => s.timestamp);
  const timestamp = timestamps.length ? Math.max(...timestamps) : Date.now();
  if (timestamps.length && timestamp - Math.min(...timestamps) > RULES.endToleranceSeconds * 1000) issues.push('Chain observations are too far apart');
  return {
    id: crypto.randomUUID(), duelId: duel.id, wallet: profile.id, chain: duel.chain,
    timestamp, block: 'multi-chain', components,
    totalUsd: components.reduce((total, s) => total.add(s.totalUsd), new Decimal(0)).toString(),
    positions: components.flatMap(s => s.positions.map(p => ({ ...p, chain: s.chain }))),
    quality: issues.length || components.some(s => s.quality === 'INCOMPLETE') ? 'INCOMPLETE' : components.some(s => s.quality !== 'HIGH') ? 'MEDIUM' : 'HIGH',
    issues: [...new Set(issues)], rulesVersion: duel.rulesVersion,
    transactionCoverage: components.length === chains.length && components.every(s => s.transactionCoverage),
  };
}
