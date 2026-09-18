import { expect, test } from '@playwright/test';
import { privateKeyToAccount } from 'viem/accounts';
import { hexToString } from 'viem';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';

// Only extension transport is simulated. The real API verifies both signatures,
// sets browser session cookies, links identities, and rejects replayed challenges.
for (const mobile of [false, true]) test(`Phantom Solana sign-in and EVM linking ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  const origin = 'http://127.0.0.1:5174';
  const fixture = crypto.randomUUID();
  await page.route('**/api/**', route => route.continue({ url: `${origin}/__test_wallet/${fixture}${new URL(route.request().url()).pathname}` }));
  const solSeed = new Uint8Array(32).fill(23), solAddress = bs58.encode(ed25519.getPublicKey(solSeed));
  const evm = privateKeyToAccount(`0x${'5'.padStart(64, '0')}`);
  const signatures: string[] = [];
  await page.exposeFunction('testSolSign', (message: number[]) => {
    const bytes = Uint8Array.from(message), text = new TextDecoder().decode(bytes);
    expect(text.split('\n')[1]).toBe(solAddress);
    signatures.push('solana');
    return Array.from(ed25519.sign(bytes, solSeed));
  });
  await page.exposeFunction('testEvmSign', async (message: `0x${string}`, address: string) => {
    const text = hexToString(message);
    expect(address).toBe(evm.address);
    expect(text.split('\n')[1]).toBe(address);
    expect(text).toContain('Chain ID: 8453');
    signatures.push('evm');
    return evm.signMessage({ message: text });
  });
  await page.addInitScript(({ solAddress, evmAddress }) => {
    const bridge = window as unknown as { testSolSign: (message: number[]) => Promise<number[]>; testEvmSign: (message: string, address: string) => Promise<string> };
    const publicKey = { toBase58: () => solAddress };
    window.phantom = {
      solana: { isPhantom: true, publicKey, connect: async () => ({ publicKey }), signMessage: async message => ({ publicKey, signature: Uint8Array.from(await bridge.testSolSign(Array.from(message))) }) },
      ethereum: { isPhantom: true, request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [evmAddress.toLowerCase()];
        if (method === 'eth_chainId') return '0x2105';
        if (method === 'personal_sign') return bridge.testEvmSign(params![0] as string, params![1] as string);
        throw new Error(`Unexpected wallet method: ${method}`);
      } },
    };
    window.ethereum = { isMetaMask: true, request: async () => { throw new Error('The other wallet must never be called when Phantom is selected.'); } };
  }, { solAddress, evmAddress: evm.address });

  await page.goto('/');
  await page.locator('.wallet-button').click();
  await page.getByRole('button', { name: 'Connect Phantom (Solana)', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const initial = await page.evaluate(async () => (await fetch('/api/me')).json());
  expect(initial.profile.wallets).toHaveLength(1);
  const profileId = initial.profile.id;
  await page.locator('.wallet-button').click();
  await expect(page.getByText(/Solana linked:/)).toBeVisible();
  await page.getByRole('button', { name: 'EVM wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Link MetaMask (EVM)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Link Phantom (EVM)', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await page.locator('.wallet-button').click();
  await expect(page.getByText(/Solana linked:/)).toBeVisible();
  await expect(page.getByText(/EVM linked:/)).toBeVisible();
  const linked = await page.evaluate(async () => (await fetch('/api/me')).json());
  expect(linked.profile.id).toBe(profileId);
  expect(linked.profile.wallets).toHaveLength(2);
  expect(linked.profile.wallets).toEqual(expect.arrayContaining([
    expect.objectContaining({ family: 'solana', address: solAddress }),
    expect.objectContaining({ family: 'evm', address: evm.address.toLowerCase() }),
  ]));
  expect(linked.points).toBe(initial.points);
  expect(signatures).toEqual(['solana', 'evm']);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.locator('.wallet-button').click();
  await page.getByRole('button', { name: 'EVM wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Phantom (EVM)', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const me = await page.evaluate(async () => (await fetch('/api/me')).json());
  expect(me.profile.id).toBe(profileId);
});
