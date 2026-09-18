import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { connectEvm, connectSolana, evmWallets, solanaWallets, watchWallets } from '../lib/wallet';

export function WalletOptions({ family, purpose, busy, run }: {
  family: 'solana' | 'evm';
  purpose: 'login' | 'link';
  busy: boolean;
  run: (connect: () => Promise<unknown>) => Promise<void>;
}) {
  const [, update] = useState(0);
  useEffect(() => watchWallets(() => update(n => n + 1)), []);
  const solana = solanaWallets(), evm = evmWallets();
  const label = purpose === 'link' ? 'Link' : 'Connect';
  const hasPhantom = family === 'solana' ? solana.some(n => n.toLowerCase() === 'phantom') : evm.some(w => w.name === 'Phantom');
  return <div className="wallet-options" aria-busy={busy}>
    {family === 'solana' ? solana.map(name => <button className="button secondary" key={name} disabled={busy} onClick={() => void run(() => connectSolana(name, purpose))}>
      {label} {name} (Solana)<ArrowRight size={16}/>
    </button>) : evm.map(wallet => <button className="button secondary" key={wallet.id} disabled={busy} onClick={() => void run(() => connectEvm(wallet, purpose))}>
      {label} {wallet.name} (EVM)<ArrowRight size={16}/>
    </button>)}
    {!hasPhantom && <p className="notice-box">Phantom for {family === 'solana' ? 'Solana' : 'EVM'} is not detected. <a href="https://phantom.com/" target="_blank" rel="noreferrer">Get Phantom</a>, or open this site in Phantom’s browser. Enable the wallet extension for this site if it is already installed.</p>}
    {busy && <p role="status">Waiting for your wallet. Approve the sign-in message to continue.</p>}
  </div>;
}
