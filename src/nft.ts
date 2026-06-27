// Real on-chain NFT minting on Solana DEVNET for the legendary cosmetics.
// The heavy Metaplex/Solana libs are dynamically imported so they never bloat the
// main bundle and any failure is fully isolated. Phantom signs the transaction;
// we submit it to a devnet RPC (so the user doesn't need Phantom set to devnet).
import { COSMETICS } from './tide.ts';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const META_BASE = 'https://battlegrid2-hxo2u.ondigitalocean.app/nft';

interface PhantomLike {
  isPhantom?: boolean;
  publicKey: { toString(): string; toBytes(): Uint8Array } | null;
  connect(o?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  signTransaction?: (tx: unknown) => Promise<unknown>;
  signAllTransactions?: (txs: unknown[]) => Promise<unknown[]>;
  signMessage?: (m: Uint8Array, d?: string) => Promise<{ signature: Uint8Array }>;
}
function phantom(): PhantomLike | null {
  const w = window as unknown as { phantom?: { solana?: PhantomLike }; solana?: PhantomLike };
  const p = w.phantom?.solana ?? w.solana;
  return p?.isPhantom ? p : null;
}

export interface MintResult { asset: string; explorer: string }

// Mint a legendary cosmetic as an mpl-core NFT to the connected wallet (devnet).
export async function mintCosmeticNft(cosmeticId: string): Promise<MintResult> {
  const c = COSMETICS.find((x) => x.id === cosmeticId);
  if (!c || !c.nft) throw new Error('Not an NFT cosmetic.');
  const p = phantom();
  if (!p) throw new Error('Phantom wallet not found — install it from phantom.app.');
  if (!p.publicKey) await p.connect();
  if (!p.publicKey || !p.signTransaction) throw new Error('Connect a Phantom wallet that can sign transactions.');

  // lazy-load the heavy on-chain libs
  const [umiBundle, web3, core, walletAdapters, umiLib] = await Promise.all([
    import('@metaplex-foundation/umi-bundle-defaults'),
    import('@solana/web3.js'),
    import('@metaplex-foundation/mpl-core'),
    import('@metaplex-foundation/umi-signer-wallet-adapters'),
    import('@metaplex-foundation/umi'),
  ]);

  const owner = new web3.PublicKey(p.publicKey.toString());

  // best-effort devnet airdrop so the user can cover the (~0.003 SOL) rent
  try {
    const conn = new web3.Connection(DEVNET_RPC, 'confirmed');
    const bal = await conn.getBalance(owner);
    if (bal < 3_000_000) {
      const sig = await conn.requestAirdrop(owner, web3.LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, 'confirmed');
    }
  } catch { /* airdrop is rate-limited; create() below surfaces a clear error if broke */ }

  // adapt Phantom to a umi wallet identity (transaction signing is what we use)
  const adapter = {
    publicKey: owner,
    signTransaction: (tx: unknown) => p.signTransaction!(tx),
    signAllTransactions: (txs: unknown[]) => (p.signAllTransactions ? p.signAllTransactions(txs) : Promise.all(txs.map((t) => p.signTransaction!(t)))),
    signMessage: async (m: Uint8Array) => (await p.signMessage!(m)).signature,
  };

  const umi = umiBundle.createUmi(DEVNET_RPC).use(walletAdapters.walletAdapterIdentity(adapter as never));
  const asset = umiLib.generateSigner(umi);
  await core.create(umi, {
    asset,
    name: c.name.replace(/^(Title|Name Color): /, ''),
    uri: `${META_BASE}/${c.id}.json`,
  }).sendAndConfirm(umi);

  const addr = asset.publicKey.toString();
  return { asset: addr, explorer: `https://solscan.io/token/${addr}?cluster=devnet` };
}
