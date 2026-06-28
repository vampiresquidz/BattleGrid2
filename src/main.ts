// Buffer polyfill for the Solana/Metaplex libs (used lazily by the NFT mint flow)
import { Buffer } from 'buffer';
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;
import './style.css';
import { BattleScene } from './battle.ts';
import { OverworldScene } from './overworld.ts';
import { login, isPhantomInstalled, tryEagerConnect, type Session } from './wallet.ts';
import { runLoading } from './loadingScreen.ts';
import { OVERWORLD_ASSETS, battleAssetsFor } from './loader.ts';
import { getSelectedBody } from './characters.ts';
import { setTouchMode } from './touch.ts';
import { startGuestMode, GUEST_SESSION } from './guest.ts';
import { isMobile, connectPhantomMobile, handleMobileRedirect } from './walletMobile.ts';
import { reownEnabled, connectReown } from './reown.ts';
import { initSfx, playSfx } from './sfx.ts';
import { initPwa } from './pwa.ts';

const app = document.getElementById('app')!;

// SFX: preload + a global click blip on interactive controls
initSfx();
document.addEventListener('pointerdown', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && t.closest('.btn, .tc-btn, .db-card, .shop-card, .ops-cos, .ops-tab, .db-tab, .db-filt, .chipcard, .db-slot, [data-claim], [data-mode]')) {
    playSfx('ui_click', 0.3);
  }
}, true);

// PWA: register the SW + capture the install prompt (install lives in Settings)
initPwa();

function showLogin() {
  const screen = document.createElement('div');
  screen.id = 'login';
  const installed = isPhantomInstalled();
  const mobile = isMobile();
  // Label: injected wallet → sign; mobile (no injection) → deeplink to the app; desktop → install.
  const connectLabel = installed ? 'Connect Phantom' : mobile ? 'Connect Phantom (app)' : 'Get Phantom Wallet';
  const wcBtn = reownEnabled() ? '<button class="btn btn-ghost" id="wc">Connect a Wallet</button>' : '';
  screen.innerHTML = `
    <h1>ABYSSAL&nbsp;GRID</h1>
    <p>An HD-2D grid battler on an alien data-world. Build a folder of chips, dive in, and delete what comes at you.</p>
    <button class="btn" id="connect">${connectLabel}</button>
    ${wcBtn}
    <button class="btn btn-ghost" id="guest">Play as Guest</button>
    <div class="status" id="status"></div>
    <div class="hint">${installed ? 'You\'ll sign a free message to log in — no transaction, no fees.'
      : mobile ? 'Opens the Phantom app to connect — no in-app browser needed.'
      : 'Phantom not detected in this browser.'}</div>
    <div class="hint">Guest mode lets you play instantly — but nothing is saved (no credits, ◊ TIDE, decks or NFTs).</div>`;
  app.appendChild(screen);

  const btn = screen.querySelector('#connect') as HTMLButtonElement;
  const status = screen.querySelector('#status') as HTMLElement;

  (screen.querySelector('#guest') as HTMLButtonElement).onclick = () => {
    startGuestMode();
    screen.remove();
    showOverworld(GUEST_SESSION);
  };

  btn.onclick = async () => {
    // 1) injected provider (desktop extension or Phantom in-app browser)
    if (isPhantomInstalled()) {
      btn.disabled = true;
      status.textContent = 'Awaiting wallet approval…';
      try {
        const session = await login();
        status.textContent = 'Signed in. Diving…';
        screen.remove();
        showOverworld(session);
      } catch (err) {
        btn.disabled = false;
        status.textContent = (err as Error).message ?? 'Login cancelled.';
      }
      return;
    }
    // 2) mobile browser with no injected wallet → Phantom deeplink (navigates away)
    if (mobile) {
      status.textContent = 'Opening Phantom…';
      connectPhantomMobile();
      return;
    }
    // 3) desktop without the extension
    window.open('https://phantom.app/', '_blank');
  };

  const wc = screen.querySelector('#wc') as HTMLButtonElement | null;
  if (wc) wc.onclick = async () => {
    wc.disabled = true;
    status.textContent = 'Opening wallet…';
    try {
      const session = await connectReown();
      screen.remove();
      showOverworld(session);
    } catch (err) {
      wc.disabled = false;
      status.textContent = (err as Error).message ?? 'Connection cancelled.';
    }
  };

  // If the wallet already trusts this site, show that we're ready (still require a click to sign).
  void tryEagerConnect().then((addr) => {
    if (addr) status.textContent = 'Wallet detected — click to sign in.';
  });
}

// ---- Game flow: overworld <-> battle ----
// Only one scene lives at a time. We tear the overworld down before diving into
// a battle (the BattleScene disposes itself before calling onExit), so their
// canvases and HUDs never overlap.
let overworld: OverworldScene | null = null;

async function showOverworld(session: Session, label = 'Loading sector…') {
  // preload overworld art behind the loading screen (startup + return-from-battle).
  // On return everything's cached so this resolves instantly; the small floor just
  // avoids a sub-frame flash.
  await runLoading(app, OVERWORLD_ASSETS, { title: 'ABYSSAL&nbsp;GRID', label, minMs: 400 });
  setTouchMode('overworld');
  overworld = new OverworldScene(app, session, {
    onEncounter: (enemyIndex) => startEncounter(session, enemyIndex),
    onPvp: (info) => startPvp(session, info),
  });
}

async function startEncounter(session: Session, enemyIndex: number) {
  overworld?.dispose();
  overworld = null;
  // preload ONLY this fight's art (player body + the one enemy) — not the whole
  // 100 MB battle set, which made every battle stall on the no-CDN host.
  const assets = battleAssetsFor(enemyIndex, [getSelectedBody()]);
  await runLoading(app, assets, { title: 'ENGAGING', label: 'Compiling combat node…', minMs: 300 });
  setTouchMode('battle');
  new BattleScene(app, session, {
    startIndex: enemyIndex,
    encounter: true,
    onExit: () => showOverworld(session, 'Recompiling sector…'),
  });
}

// PvP duel: the overworld hands off its live socket; we keep it alive for the
// fight, then close it on exit so the rebuilt overworld reconnects fresh.
async function startPvp(session: Session, info: import('./overworld.ts').PvpInfo) {
  overworld?.dispose();
  overworld = null;
  // no roster enemy — just the two combatant bodies' battle sheets
  const assets = battleAssetsFor(null, [getSelectedBody(), info.oppBody]);
  await runLoading(app, assets, { title: 'DUEL', label: 'Syncing opponent…', minMs: 300 });
  setTouchMode('battle');
  new BattleScene(app, session, {
    encounter: true,
    pvp: info,
    onExit: () => { info.net.dispose(); showOverworld(session, 'Recompiling sector…'); },
  });
}

// Dev bypass: ?dev skips the Phantom gate so we can iterate/screenshot without a
// wallet. ?battle (optionally &enemy=N) jumps straight into the gauntlet battle;
// otherwise we start in the overworld. Never triggers in normal use.
const params = new URLSearchParams(location.search);
if (params.has('dev')) {
  // dev/QA hook: poke the ◊ TIDE economy from headless tests
  void import('./tide.ts').then((t) => { (window as unknown as Record<string, unknown>).__tide = t; });
  const session: Session = { address: 'DEV', short: 'DEV', signature: '' };
  if (params.has('battle')) {
    const idx = Number(params.get('enemy') ?? 0);
    runLoading(app, battleAssetsFor(idx, [getSelectedBody()]), { title: 'ENGAGING', label: 'Compiling combat node…', minMs: 300 })
      .then(() => { setTouchMode('battle'); return new BattleScene(app, session, { startIndex: idx }); });
  } else { void showOverworld(session); }
} else {
  // Resume a Phantom mobile-deeplink login if we're mid-redirect; else show login.
  void handleMobileRedirect().then((session) => {
    if (session) showOverworld(session);
    else showLogin();
  });
}
