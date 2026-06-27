// Verifies the on-chain mint path for real on Solana DEVNET, using a throwaway
// keypair as the signer (the ONLY difference from the in-game Phantom flow —
// same umi + mpl-core create() call as src/nft.ts).
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { generateSigner, keypairIdentity } from '@metaplex-foundation/umi';
import { create } from '@metaplex-foundation/mpl-core';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

const RPC = 'https://api.devnet.solana.com';
const URI = 'https://battlegrid2-hxo2u.ondigitalocean.app/nft/b_crown.json';

const umi = createUmi(RPC);
const kp = umi.eddsa.generateKeypair();
umi.use(keypairIdentity(kp));
console.log('payer:', kp.publicKey);

// airdrop devnet SOL (retry — public faucet is rate-limited)
const conn = new Connection(RPC, 'confirmed');
const owner = new PublicKey(kp.publicKey);
let funded = false;
for (let i = 0; i < 4 && !funded; i++) {
  try {
    const sig = await conn.requestAirdrop(owner, LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, 'confirmed');
    funded = (await conn.getBalance(owner)) > 0;
    console.log(`airdrop ${i+1}: balance`, (await conn.getBalance(owner))/LAMPORTS_PER_SOL, 'SOL');
  } catch (e) { console.log(`airdrop ${i+1} failed:`, (e.message||e).slice(0,120)); await new Promise(r=>setTimeout(r,3000)); }
}
if (!funded) { console.log('FAUCET_RATE_LIMITED — could not fund; aborting mint'); process.exit(2); }

const asset = generateSigner(umi);
console.log('minting asset:', asset.publicKey);
await create(umi, { asset, name: 'Abyssal Grid — Apex Badge', uri: URI }).sendAndConfirm(umi);
console.log('MINTED OK');
console.log('asset:', asset.publicKey);
console.log('solscan: https://solscan.io/token/' + asset.publicKey + '?cluster=devnet');
