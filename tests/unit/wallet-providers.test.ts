import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWallets } from '@wallet-standard/app';
import { privateKeyToAccount } from 'viem/accounts';
import { stringToHex } from 'viem';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519';
import { api } from '../../apps/web/src/lib/api';
import { connectEvm, connectSolana, evmWallets, solanaWallets, watchWallets, type EthereumProvider } from '../../apps/web/src/lib/wallet';

vi.mock('../../apps/web/src/lib/api', () => ({ api: vi.fn() }));
vi.mock('@wallet-standard/app', () => ({ getWallets: vi.fn() }));
const evm = privateKeyToAccount(`0x${'3'.padStart(64, '0')}`);
const other = privateKeyToAccount(`0x${'4'.padStart(64, '0')}`);
const solKey = ed25519.getPublicKey(new Uint8Array(32).fill(9));
const solAddress = bs58.encode(solKey);
const publicKey = { toBase58: () => solAddress };
const challenge = (address: string) => ({ nonce: 'a'.repeat(32), message: `localhost wants you to sign in with your account:\n${address}\n\nSign in.` });
const apiMock = vi.mocked(api);
let connected: string, chainId: string;
function evmProvider() {
  return { isPhantom: true, request: vi.fn(async ({ method }: { method: string; params?: unknown[] }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [connected];
    if (method === 'eth_chainId') return chainId;
    if (method === 'personal_sign') return '0xsignature';
    throw new Error(`Unexpected method ${method}`);
  }) } satisfies EthereumProvider;
}
function phantomSolana() {
  return { isPhantom: true, publicKey, connect: vi.fn(async () => ({ publicKey })), signMessage: vi.fn(async () => ({ publicKey, signature: new Uint8Array(64).fill(1) })) };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', new EventTarget());
  vi.mocked(getWallets).mockReturnValue({ get: () => [], on: () => () => {} } as unknown as ReturnType<typeof getWallets>);
  connected = evm.address.toLowerCase(); chainId = '0x2105';
  apiMock.mockImplementation(async (path, options) => path === '/auth/nonce' ? challenge((options!.body as { wallet: string }).wallet) : { ok: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('explicit Phantom providers and signing account consistency', () => {
  it('keeps Phantom EVM separate from another extension and uses the same checksum in message and personal_sign', async () => {
    const phantom = evmProvider(), wrong = { isMetaMask: true, request: vi.fn() };
    window.phantom = { ethereum: phantom }; window.ethereum = wrong;
    const selected = evmWallets().find(w => w.name === 'Phantom')!;
    expect(evmWallets().map(w => w.name)).toEqual(['Phantom', 'MetaMask']);
    await connectEvm(selected, 'link');
    expect(wrong.request).not.toHaveBeenCalled();
    expect(apiMock).toHaveBeenCalledWith('/auth/nonce', { method: 'POST', body: { chain: 'base', evmChainId: 8453, wallet: evm.address, purpose: 'link' } });
    expect(phantom.request).toHaveBeenCalledWith({ method: 'personal_sign', params: [stringToHex(challenge(evm.address).message), evm.address] });
    expect(apiMock).toHaveBeenCalledWith('/auth/verify', expect.anything());
  });
  it.each(['account', 'network', 'challenge'])('stops before signing when the %s changes while fetching the nonce', async change => {
    const provider = evmProvider();
    apiMock.mockImplementationOnce(async () => {
      if (change === 'account') connected = other.address;
      if (change === 'network') chainId = '0x1';
      return challenge(change === 'challenge' ? other.address : evm.address);
    });
    await expect(connectEvm({ id: 'phantom', name: 'Phantom', provider })).rejects.toThrow(/changed|does not match/);
    expect(provider.request.mock.calls.some(([call]) => call.method === 'personal_sign')).toBe(false);
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
  it('rejects an account change during the signing prompt before verifying a session', async () => {
    const provider = evmProvider(), original = provider.request.getMockImplementation()!;
    provider.request.mockImplementation(async args => { const value = await original(args); if (args.method === 'personal_sign') connected = other.address; return value; });
    await expect(connectEvm({ id: 'phantom', name: 'Phantom', provider })).rejects.toThrow('account changed');
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
  it('supports Phantom Solana without waiting for Wallet Standard registration', async () => {
    const solana = phantomSolana(), ethereum = evmProvider();
    window.phantom = { solana, ethereum };
    expect(solanaWallets()).toEqual(['Phantom']);
    await connectSolana('Phantom', 'link');
    expect(ethereum.request).not.toHaveBeenCalled();
    expect(solana.signMessage).toHaveBeenCalledWith(new TextEncoder().encode(challenge(solAddress).message), 'utf8');
    expect(apiMock).toHaveBeenCalledWith('/auth/nonce', { method: 'POST', body: { chain: 'solana', wallet: solAddress, purpose: 'link' } });
    expect(apiMock).toHaveBeenCalledWith('/auth/verify', expect.anything());
  });
  it('stops a Solana account change before showing a mismatched signature request', async () => {
    const solana = phantomSolana(); window.phantom = { solana };
    apiMock.mockImplementationOnce(async () => { solana.publicKey = { toBase58: () => 'another-account' }; return challenge(solAddress); });
    await expect(connectSolana('Phantom')).rejects.toThrow('account changed');
    expect(solana.signMessage).not.toHaveBeenCalled();
  });
  it('discovers late EIP-6963 providers and unsubscribes on close', () => {
    const changed = vi.fn(), stop = watchWallets(changed), provider = evmProvider();
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: 'test-phantom', name: 'Phantom' }, provider } }));
    const count = changed.mock.calls.length; announce();
    expect(changed).toHaveBeenCalledTimes(count + 1);
    expect(evmWallets().find(w => w.id === 'test-phantom')?.provider).toBe(provider);
    stop(); window.dispatchEvent(new Event('focus'));
    expect(changed).toHaveBeenCalledTimes(count + 1);
  });
  it.each(['key mismatch', 'modified message', 'valid'])('checks Wallet Standard account and signed bytes: %s', async scenario => {
    const account = { address: solAddress, publicKey: scenario === 'key mismatch' ? new Uint8Array(32) : solKey, chains: ['solana:mainnet'], features: ['solana:signMessage'] };
    const sign = vi.fn(async ({ message }: { message: Uint8Array }) => [{ signature: new Uint8Array(64), signedMessage: scenario === 'modified message' ? new Uint8Array([1]) : message }]);
    const wallet = { name: 'Solflare', accounts: [account], features: { 'standard:connect': { connect: async () => ({ accounts: [account] }) }, 'solana:signMessage': { signMessage: sign } } };
    vi.mocked(getWallets).mockReturnValue({ get: () => [wallet], on: () => () => {} } as unknown as ReturnType<typeof getWallets>);
    if (scenario === 'valid') { await connectSolana('Solflare'); expect(apiMock).toHaveBeenCalledWith('/auth/verify', expect.anything()); }
    else { await expect(connectSolana('Solflare')).rejects.toThrow(/changed|different message/); expect(apiMock.mock.calls.some(([path]) => path === '/auth/verify')).toBe(false); }
    if (scenario === 'key mismatch') expect(sign).not.toHaveBeenCalled();
  });
});
