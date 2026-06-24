// Phantom wallet login on Solana.
//
// For the prototype, "login" means: connect to Phantom, then sign a plain-text
// message to prove ownership of the wallet. We don't talk to the chain yet —
// the signed message is a self-contained proof of identity. Later this is where
// you'd verify the signature server-side, mint chip NFTs, read token balances, etc.

export interface PhantomProvider {
  isPhantom?: boolean;
  publicKey: { toString(): string } | null;
  isConnected: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, display?: 'utf8' | 'hex'): Promise<{ signature: Uint8Array }>;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

export interface Session {
  address: string;
  short: string;
  signature: string; // base64 of the login signature
}

function getProvider(): PhantomProvider | null {
  const anyWin = window as unknown as { phantom?: { solana?: PhantomProvider }; solana?: PhantomProvider };
  const provider = anyWin.phantom?.solana ?? anyWin.solana;
  if (provider?.isPhantom) return provider;
  return null;
}

export function isPhantomInstalled(): boolean {
  return getProvider() !== null;
}

function shorten(addr: string): string {
  return addr.length > 8 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const LOGIN_PREFIX = 'Sign in to Abyssal Grid\n\nThis request will not trigger a transaction or cost any fees.\nNonce: ';

export async function login(): Promise<Session> {
  const provider = getProvider();
  if (!provider) {
    throw new Error('Phantom wallet not found. Install it from phantom.app');
  }

  const { publicKey } = await provider.connect();
  const address = publicKey.toString();

  // A nonce makes each login message unique. crypto.getRandomValues is fine here.
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = toBase64(nonceBytes);
  const message = new TextEncoder().encode(LOGIN_PREFIX + nonce);

  const { signature } = await provider.signMessage(message, 'utf8');

  return { address, short: shorten(address), signature: toBase64(signature) };
}

export async function tryEagerConnect(): Promise<string | null> {
  const provider = getProvider();
  if (!provider) return null;
  try {
    const res = await provider.connect({ onlyIfTrusted: true });
    return res.publicKey.toString();
  } catch {
    return null; // not previously trusted — user must click connect
  }
}
