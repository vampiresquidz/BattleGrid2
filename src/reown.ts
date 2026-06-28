// Multi-wallet login via Reown AppKit (WalletConnect v2). Works on desktop (QR)
// and any mobile browser (deeplinks to the wallet app) — not just Phantom.
// Heavy AppKit libs are dynamically imported so they never touch the main bundle
// unless used. Requires a (free, public) WalletConnect project id in
// VITE_WC_PROJECT_ID; without it the button is hidden.
import type { Session } from './wallet.ts';

const PROJECT_ID = ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WC_PROJECT_ID) || '';
export function reownEnabled(): boolean { return PROJECT_ID.length > 0; }

const LOGIN_PREFIX = 'Sign in to Abyssal Grid\n\nThis request will not trigger a transaction or cost any fees.\nNonce: ';
function shorten(a: string) { return a.length > 8 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a; }
function b64(bytes: Uint8Array) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }

let modal: { open: () => void; subscribeAccount: (cb: (a: { isConnected?: boolean; address?: string }) => void) => (() => void) | void; getWalletProvider?: () => unknown } | null = null;

export async function connectReown(): Promise<Session> {
  if (!reownEnabled()) throw new Error('WalletConnect is not configured (set VITE_WC_PROJECT_ID).');
  const [{ createAppKit }, { SolanaAdapter }, networks] = await Promise.all([
    import('@reown/appkit'),
    import('@reown/appkit-adapter-solana'),
    import('@reown/appkit/networks'),
  ]);

  if (!modal) {
    modal = createAppKit({
      adapters: [new SolanaAdapter()],
      networks: [networks.solana, networks.solanaDevnet],
      projectId: PROJECT_ID,
      metadata: {
        name: 'Abyssal Grid',
        description: 'HD-2D grid battler on an alien data-world.',
        url: location.origin,
        icons: [`${location.origin}/icon-192.png`],
      },
      features: { analytics: false, email: false, socials: [] },
    }) as unknown as typeof modal;
  }

  return new Promise<Session>((resolve, reject) => {
    let done = false;
    const finish = async (address: string) => {
      if (done) return; done = true;
      try {
        const provider = modal!.getWalletProvider?.() as { signMessage?: (m: Uint8Array) => Promise<Uint8Array | { signature: Uint8Array }> } | undefined;
        let sig = '';
        if (provider?.signMessage) {
          const msg = new TextEncoder().encode(LOGIN_PREFIX + b64(crypto.getRandomValues(new Uint8Array(12))));
          const out = await provider.signMessage(msg);
          const bytes = out instanceof Uint8Array ? out : out.signature;
          sig = b64(bytes);
        }
        resolve({ address, short: shorten(address), signature: sig });
      } catch (e) { reject(e as Error); }
    };
    const unsub = modal!.subscribeAccount((acc) => {
      if (acc?.isConnected && acc.address) { (unsub as (() => void) | undefined)?.(); void finish(acc.address); }
    });
    modal!.open();
    setTimeout(() => { if (!done) reject(new Error('Wallet connection timed out.')); }, 120000);
  });
}
