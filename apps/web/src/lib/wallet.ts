import { getWallets } from '@wallet-standard/app';
import bs58 from 'bs58';
import { getAddress, stringToHex } from 'viem';
import { CHAINS, CHAIN_IDS } from '@shared/config';
import { api } from './api';
export interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isPhantom?: boolean;
  isMetaMask?: boolean;
  isRabby?: boolean;
}
type PublicKey = { toBase58: () => string };
interface PhantomSolana {
  isPhantom?: boolean;
  publicKey: PublicKey | null;
  connect: () => Promise<{ publicKey: PublicKey }>;
  signMessage: (message: Uint8Array, display: 'utf8') => Promise<{ signature: Uint8Array; publicKey: PublicKey }>;
}
declare global {
  interface Window {
    ethereum?: EthereumProvider;
    phantom?: { ethereum?: EthereumProvider; solana?: PhantomSolana };
  }
}
type WalletAccount = { address: string; publicKey: Uint8Array; chains: readonly string[]; features: readonly string[] };
type StandardConnect = { connect: () => Promise<{ accounts: readonly WalletAccount[] }> };
type StandardSign = { signMessage: (args: { account: WalletAccount; message: Uint8Array }) => Promise<{ signature: Uint8Array; signedMessage: Uint8Array }[]> };
export type EvmWallet = { id: string; name: string; provider: EthereumProvider };
type Announcement = { info: { uuid: string; name: string }; provider: EthereumProvider };
const announced = new Map<string, EvmWallet>();
const accountChanged = 'The selected wallet account changed. Choose your account in the wallet and connect again.';

export function standardWallets() { return getWallets().get().filter(w => 'standard:connect' in w.features && 'solana:signMessage' in w.features); }
export function solanaWallets() {
  const names = standardWallets().map(w => w.name);
  if (window.phantom?.solana?.isPhantom && !names.some(n => n.toLowerCase() === 'phantom')) names.unshift('Phantom');
  return names;
}
export function evmWallets(): EvmWallet[] {
  const wallets: EvmWallet[] = [];
  const phantom = window.phantom?.ethereum;
  if (phantom?.isPhantom) wallets.push({ id: 'phantom', name: 'Phantom', provider: phantom });
  for (const wallet of announced.values()) {
    if (!wallets.some(w => w.provider === wallet.provider || (w.provider.isPhantom && wallet.provider.isPhantom))) wallets.push(wallet);
  }
  const injected = window.ethereum;
  if (injected && !wallets.some(w => w.provider === injected || (w.provider.isPhantom && injected.isPhantom))) {
    wallets.push({ id: 'injected', name: injected.isPhantom ? 'Phantom' : injected.isRabby ? 'Rabby' : injected.isMetaMask ? 'MetaMask' : 'Browser wallet', provider: injected });
  }
  return wallets;
}

// Discover late Wallet Standard registrations and EIP-6963 announcements.
export function watchWallets(onChange: () => void) {
  const registry = getWallets();
  const offRegister = registry.on('register', onChange);
  const offUnregister = registry.on('unregister', onChange);
  const announce = (event: Event) => {
    const detail = (event as CustomEvent<Announcement>).detail;
    if (!detail || typeof detail.info?.uuid !== 'string' || typeof detail.info?.name !== 'string' || typeof detail.provider?.request !== 'function') return;
    if (announced.get(detail.info.uuid)?.provider === detail.provider) return;
    announced.set(detail.info.uuid, { id: detail.info.uuid, name: detail.provider.isPhantom ? 'Phantom' : detail.info.name, provider: detail.provider });
    onChange();
  };
  window.addEventListener('eip6963:announceProvider', announce);
  window.addEventListener('ethereum#initialized', onChange);
  window.addEventListener('focus', onChange);
  window.addEventListener('load', onChange);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  onChange();
  return () => {
    offRegister(); offUnregister();
    window.removeEventListener('eip6963:announceProvider', announce);
    window.removeEventListener('ethereum#initialized', onChange);
    window.removeEventListener('focus', onChange);
    window.removeEventListener('load', onChange);
  };
}

function checkChallenge(message: string, address: string) {
  if (message.split('\n')[1] !== address) throw new Error('The sign-in message does not match your selected wallet. Reconnect and try again.');
}
function checkSolanaAccount(account: { address: string; publicKey: ArrayLike<number> }) {
  if (account.publicKey.length !== 32 || bs58.encode(Uint8Array.from(account.publicKey)) !== account.address) throw new Error(accountChanged);
}
async function connectPhantomSolana(provider: PhantomSolana, purpose: 'login' | 'link') {
  const { publicKey } = await provider.connect();
  const wallet = publicKey.toBase58();
  const assertAccount = () => {
    if (provider.publicKey?.toBase58() !== wallet) throw new Error(accountChanged);
  };
  assertAccount();
  const challenge = await api<{ nonce: string; message: string }>('/auth/nonce', { method: 'POST', body: { chain: 'solana', wallet, purpose } });
  checkChallenge(challenge.message, wallet);
  assertAccount();
  const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), 'utf8');
  assertAccount();
  if (signed.publicKey.toBase58() !== wallet) throw new Error(accountChanged);
  return api('/auth/verify', { method: 'POST', body: { nonce: challenge.nonce, signature: bs58.encode(signed.signature) } });
}
export async function connectSolana(walletName: string, purpose: 'login' | 'link' = 'login') {
  // Phantom's dedicated namespace avoids collisions with other extensions.
  const phantom = window.phantom?.solana;
  if (walletName.toLowerCase() === 'phantom' && phantom?.isPhantom) return connectPhantomSolana(phantom, purpose);
  const wallet = standardWallets().find(w => w.name === walletName);
  if (!wallet) throw new Error('Open this site in your wallet browser, or install the wallet extension and reload.');
  const { accounts } = await (wallet.features['standard:connect'] as StandardConnect).connect();
  const account = accounts.find(a => a.chains.some(c => c.startsWith('solana:')) && a.features.includes('solana:signMessage'));
  if (!account) throw new Error('No Solana account with message signing was returned.');
  checkSolanaAccount(account);
  const assertAccount = () => {
    const current = wallet.accounts.find(a => a.chains.some(c => c.startsWith('solana:')) && a.features.includes('solana:signMessage'));
    if (!current || current.address !== account.address) throw new Error(accountChanged);
    checkSolanaAccount(current);
  };
  assertAccount();
  const challenge = await api<{ nonce: string; message: string }>('/auth/nonce', { method: 'POST', body: { chain: 'solana', wallet: account.address, purpose } });
  checkChallenge(challenge.message, account.address);
  assertAccount();
  const message = new TextEncoder().encode(challenge.message);
  const [signed] = await (wallet.features['solana:signMessage'] as StandardSign).signMessage({ account, message });
  assertAccount();
  if (!signed || signed.signedMessage.length !== message.length || !signed.signedMessage.every((byte, i) => byte === message[i])) throw new Error('Your wallet signed a different message. Reconnect and try again.');
  return api('/auth/verify', { method: 'POST', body: { nonce: challenge.nonce, signature: bs58.encode(signed.signature) } });
}
export async function connectEvm(selected: EvmWallet, purpose: 'login' | 'link' = 'login') {
  // Retain the exact provider the user chose throughout the entire sign-in.
  const provider = selected.provider;
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  if (!accounts[0]) throw new Error('No wallet account was selected.');
  const wallet = getAddress(accounts[0]);
  const evmChainId = Number(await provider.request({ method: 'eth_chainId' }));
  if (!Number.isSafeInteger(evmChainId) || evmChainId <= 0) throw new Error('Your wallet returned an invalid network. Reconnect and try again.');
  const assertAccount = async () => {
    const current = await provider.request({ method: 'eth_accounts' }) as string[];
    if (!current[0] || getAddress(current[0]) !== wallet) throw new Error(accountChanged);
    if (Number(await provider.request({ method: 'eth_chainId' })) !== evmChainId) throw new Error('Your wallet network changed. Connect again to request a new sign-in message.');
  };
  const chain = CHAIN_IDS.find(c => c !== 'solana' && CHAINS[c].id === evmChainId) ?? 'ethereum';
  // Wallet signatures prove address ownership across EVM networks; no network switch is needed.
  const challenge = await api<{ nonce: string; message: string }>('/auth/nonce', { method: 'POST', body: { chain, evmChainId, wallet, purpose } });
  checkChallenge(challenge.message, wallet);
  await assertAccount();
  const signature = await provider.request({ method: 'personal_sign', params: [stringToHex(challenge.message), wallet] });
  await assertAccount();
  return api('/auth/verify', { method: 'POST', body: { nonce: challenge.nonce, signature } });
}
