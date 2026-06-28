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
import { openSettings } from './settings.ts';

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
  const wcBtn = reownEnabled() ? '<button class="menu-btn" id="wc">Connect a Wallet</button>' : '';
  screen.innerHTML = `
    <video class="landing-bg" autoplay loop muted playsinline></video>
    <div class="landing-scrim"></div>
    <div class="landing-content">
      <div class="landing-logo">
        <span class="lg-1">ABYSSAL</span>
        <span class="lg-2">GRID</span>
      </div>
      <p class="landing-tag">An HD-2D grid battler in a digital agent world. Build a folder of chips, jack in, and delete what comes at you.</p>
      <div class="landing-menu">
        <button class="menu-btn primary" id="connect">${connectLabel}</button>
        <button class="menu-btn" id="guest">Play as Guest</button>
        ${wcBtn}
        <button class="menu-btn" id="settings">Settings</button>
      </div>
      <div class="status" id="status"></div>
      <div class="hint">${installed ? 'You\'ll sign a free message to log in — no transaction, no fees.'
        : mobile ? 'Tap Connect Phantom to open the app — no in-app browser needed.'
        : 'Connect Phantom to save progress, or play instantly as a guest.'}</div>
    </div>
    <div class="landing-ver">v0.0.1 · simulated economy</div>
    <div class="landing-social">
      <a class="social-btn" href="https://github.com/vampiresquidz/BattleGrid2" target="_blank" rel="noopener" title="Source on GitHub" aria-label="GitHub">
        <svg viewBox="0 0 16 16" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
      </a>
    </div>`;
  app.appendChild(screen);

  // animated pixel-art background (falls back to the CSS gradient if absent)
  const bg = screen.querySelector('.landing-bg') as HTMLVideoElement;
  bg.onerror = () => { bg.style.display = 'none'; };
  bg.src = '/landing.mp4';
  bg.play?.().catch(() => { /* autoplay may need a gesture; gradient covers it */ });

  (screen.querySelector('#settings') as HTMLButtonElement).onclick = () => openSettings(app, null);

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
