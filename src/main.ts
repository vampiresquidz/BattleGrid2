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

const app = document.getElementById('app')!;

function showLogin() {
  const screen = document.createElement('div');
  screen.id = 'login';
  const installed = isPhantomInstalled();
  screen.innerHTML = `
    <h1>ABYSSAL&nbsp;GRID</h1>
    <p>An HD-2D grid battler on an alien data-world. Build a folder of chips, dive in, and delete what comes at you.</p>
    <button class="btn" id="connect">${installed ? 'Connect Phantom' : 'Get Phantom Wallet'}</button>
    <div class="status" id="status"></div>
    <div class="hint">${installed ? 'You\'ll sign a free message to log in — no transaction, no fees.' : 'Phantom not detected in this browser.'}</div>`;
  app.appendChild(screen);

  const btn = screen.querySelector('#connect') as HTMLButtonElement;
  const status = screen.querySelector('#status') as HTMLElement;

  btn.onclick = async () => {
    if (!isPhantomInstalled()) {
      window.open('https://phantom.app/', '_blank');
      return;
    }
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
      .then(() => new BattleScene(app, session, { startIndex: idx }));
  } else { void showOverworld(session); }
} else {
  showLogin();
}
