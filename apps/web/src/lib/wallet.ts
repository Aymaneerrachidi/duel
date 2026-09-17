import { getWallets } from '@wallet-standard/app';
import bs58 from 'bs58';
import { CHAINS, CHAIN_IDS } from '@shared/config';
import { api } from './api';
interface EthereumProvider { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
declare global { interface Window { ethereum?: EthereumProvider } }
type WalletAccount = { address: string; publicKey: Uint8Array; chains: readonly string[]; features: readonly string[] };
type StandardConnect = { connect: () => Promise<{ accounts: WalletAccount[] }> };
type StandardSign = { signMessage: (args: { account: WalletAccount; message: Uint8Array }) => Promise<{ signature: Uint8Array }[]> };
export function standardWallets() { return getWallets().get().filter(w => 'standard:connect' in w.features && 'solana:signMessage' in w.features); }
export async function connectSolana(walletName: string, purpose: 'login' | 'link' = 'login') {
  const w = standardWallets().find(w => w.name === walletName);
  if (!w) throw new Error('Install a Solana wallet, then reload this page.');
  const { accounts } = await (w.features['standard:connect'] as StandardConnect).connect();
  const account = accounts.find(a => a.chains.some(c => c.startsWith('solana:')));
  if (!account) throw new Error('No Solana account was returned.');
  const challenge = await api<{ nonce: string; message: string }>('/auth/nonce', { method: 'POST', body: { chain: 'solana', wallet: account.address, purpose } });
  const [signed] = await (w.features['solana:signMessage'] as StandardSign).signMessage({ account, message: new TextEncoder().encode(challenge.message) });
  return api('/auth/verify', { method: 'POST', body: { nonce: challenge.nonce, signature: bs58.encode(signed.signature) } });
}
export async function connectEvm(purpose: 'login' | 'link' = 'login') {
  const provider = window.ethereum;
  if (!provider) throw new Error('Install an EVM wallet such as MetaMask or Rabby, then reload.');
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  const wallet = accounts[0];
  if (!wallet) throw new Error('No wallet account was selected.');
  const evmChainId = Number(await provider.request({ method: 'eth_chainId' }));
  const chain = CHAIN_IDS.find(c => c !== 'solana' && CHAINS[c].id === evmChainId) ?? 'ethereum';
  // Wallet signatures prove address ownership across EVM networks; no network switch is needed.
  const challenge = await api<{ nonce: string; message: string }>('/auth/nonce', { method: 'POST', body: { chain, evmChainId, wallet, purpose } });
  const message = '0x' + Array.from(new TextEncoder().encode(challenge.message), c => c.toString(16).padStart(2, '0')).join('');
  const signature = await provider.request({ method: 'personal_sign', params: [message, wallet] });
  return api('/auth/verify', { method: 'POST', body: { nonce: challenge.nonce, signature } });
}
