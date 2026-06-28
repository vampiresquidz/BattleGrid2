// Mobile wallet login WITHOUT a wallet in-app browser, via Phantom universal-link
// deeplinks. A normal mobile browser has no injected window.solana, so we hand off
// to the Phantom app and come back through a redirect, carrying an encrypted
// payload (NaCl box). Two hops: connect → signMessage. State survives the page
// reloads via sessionStorage. Works on iOS + Android with the Phantom app.
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import type { Session } from './wallet.ts';

const BASE = 'https://phantom.app/ul/v1/';
const LOGIN_PREFIX = 'Sign in to Abyssal Grid\n\nThis request will not trigger a transaction or cost any fees.\nNonce: ';
const SS = {
  secret: 'pml.dappSecret', // bs58 dapp box secret key
  shared: 'pml.shared',     // bs58 precomputed shared secret (after connect)
  session: 'pml.session',   // phantom session token
  addr: 'pml.addr',         // wallet pubkey (after connect)
};

export function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || ((navigator.maxTouchPoints || 0) > 1 && !('onmouseenter' in window && matchMedia('(pointer:fine)').matches));
}

function shorten(a: string) { return a.length > 8 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a; }
function b64(bytes: Uint8Array) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function clearUrl() { try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ } }
function clearSession() { for (const k of Object.values(SS)) sessionStorage.removeItem(k); }

// ---- step 1: open Phantom to connect ----
export function connectPhantomMobile(): void {
  const kp = nacl.box.keyPair();
  sessionStorage.setItem(SS.secret, bs58.encode(kp.secretKey));
  const params = new URLSearchParams({
    dapp_encryption_public_key: bs58.encode(kp.publicKey),
    cluster: 'mainnet-beta',
    app_url: location.origin,
    redirect_link: `${location.origin}/?phantom=connect`,
  });
  location.href = `${BASE}connect?${params}`;
}

// ---- step 2 (after connect redirect): open Phantom to sign the login message ----
function requestSignMessage() {
  const secret = sessionStorage.getItem(SS.secret);
  const shared = sessionStorage.getItem(SS.shared);
  const session = sessionStorage.getItem(SS.session);
  if (!secret || !shared || !session) return;
  const sharedKey = bs58.decode(shared);
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const message = new TextEncoder().encode(LOGIN_PREFIX + b64(crypto.getRandomValues(new Uint8Array(12))));
  const payload = new TextEncoder().encode(JSON.stringify({ message: bs58.encode(message), session }));
  const encrypted = nacl.box.after(payload, nonce, sharedKey);
  const dappPub = nacl.box.keyPair.fromSecretKey(bs58.decode(secret)).publicKey;
  const params = new URLSearchParams({
    dapp_encryption_public_key: bs58.encode(dappPub),
    nonce: bs58.encode(nonce),
    redirect_link: `${location.origin}/?phantom=sign`,
    payload: bs58.encode(encrypted),
  });
  location.href = `${BASE}signMessage?${params}`;
}

// Called on every app load. Returns a Session if a sign redirect just completed,
// null if there's no Phantom redirect in progress. (On the connect hop it kicks
// off the sign request and the page navigates away — the returned promise then
// never resolves, which is intended.)
export async function handleMobileRedirect(): Promise<Session | null> {
  const q = new URLSearchParams(location.search);
  const phase = q.get('phantom');
  if (!phase) return null;

  if (q.get('errorCode')) { clearUrl(); clearSession(); return null; }

  try {
    if (phase === 'connect') {
      const phantomPub = q.get('phantom_encryption_public_key');
      const data = q.get('data'); const nonce = q.get('nonce');
      const secret = sessionStorage.getItem(SS.secret);
      if (!phantomPub || !data || !nonce || !secret) { clearUrl(); return null; }
      const shared = nacl.box.before(bs58.decode(phantomPub), bs58.decode(secret));
      const decrypted = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), shared);
      if (!decrypted) { clearUrl(); clearSession(); return null; }
      const info = JSON.parse(new TextDecoder().decode(decrypted)) as { public_key: string; session: string };
      sessionStorage.setItem(SS.shared, bs58.encode(shared));
      sessionStorage.setItem(SS.session, info.session);
      sessionStorage.setItem(SS.addr, info.public_key);
      clearUrl();
      requestSignMessage();              // hop 2 — navigates away
      return new Promise<Session | null>(() => { /* page is unloading */ });
    }

    if (phase === 'sign') {
      const data = q.get('data'); const nonce = q.get('nonce');
      const shared = sessionStorage.getItem(SS.shared);
      const addr = sessionStorage.getItem(SS.addr);
      if (!data || !nonce || !shared || !addr) { clearUrl(); clearSession(); return null; }
      const decrypted = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), bs58.decode(shared));
      clearUrl();
      const sig = decrypted ? (JSON.parse(new TextDecoder().decode(decrypted)).signature as string) : '';
      const session: Session = { address: addr, short: shorten(addr), signature: sig || '' };
      clearSession();
      return session;
    }
  } catch { clearUrl(); clearSession(); return null; }
  return null;
}
