// Lightweight sound-effects player. The mp3s in /sfx are static ElevenLabs-
// generated assets (the API key is only used at build time, never shipped).
// Sounds overlap by cloning a preloaded <audio>; respects a persisted mute pref.
const NAMES = [
  'ui_click', 'ui_confirm', 'buster', 'cannon', 'slash', 'bomb', 'hit', 'hurt',
  'freeze', 'heal', 'victory', 'defeat', 'pa', 'mint',
] as const;
export type Sfx = typeof NAMES[number];

let muted = false;
try { muted = localStorage.getItem('abyssal.muted') === '1'; } catch { /* ignore */ }

const bank: Partial<Record<Sfx, HTMLAudioElement>> = {};
let ready = false;

export function initSfx() {
  if (ready) return;
  ready = true;
  for (const n of NAMES) {
    const a = new Audio(`/sfx/${n}.mp3?v=2`); // version → cache-bust on updates
    a.preload = 'auto';
    bank[n] = a;
  }
}

export function isMuted() { return muted; }
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('abyssal.muted', m ? '1' : '0'); } catch { /* ignore */ }
}
export function toggleMuted() { setMuted(!muted); return muted; }

const lastPlay: Partial<Record<Sfx, number>> = {};
export function playSfx(name: Sfx, vol = 0.5) {
  if (muted || !ready) return;
  const base = bank[name];
  if (!base) return;
  // throttle: don't let the same sound machine-gun on rapid taps
  const now = (performance?.now?.() ?? Date.now());
  if (now - (lastPlay[name] ?? -1e9) < 70) return;
  lastPlay[name] = now;
  try {
    const a = base.cloneNode(true) as HTMLAudioElement;
    a.volume = Math.max(0, Math.min(1, vol));
    void a.play().catch(() => { /* autoplay can be blocked until a gesture */ });
  } catch { /* ignore */ }
}

// map a chip kind to a fitting sound (undefined → let a special-case handle it)
const SLASH = new Set(['sword', 'wsword', 'lance', 'shatter', 'deltaray', 'lifesword', 'cyclone']);
const BOOM = new Set(['bomb', 'minibomb', 'quake', 'forkbomb', 'bassgs', 'timebomb']);
const HEAL = new Set(['recover', 'megaheal', 'roll']);
const ICE = new Set(['freeze', 'blizzard', 'iceshot', 'icewall', 'holy']);
const GUARD = new Set(['guard', 'aura', 'bulwark', 'reflect', 'windwall', 'antidmg']);
export function sfxForChip(kind: string): Sfx | undefined {
  if (kind === 'pa') return undefined; // firePA plays its own
  if (SLASH.has(kind)) return 'slash';
  if (BOOM.has(kind)) return 'bomb';
  if (HEAL.has(kind)) return 'heal';
  if (ICE.has(kind)) return 'freeze';
  if (GUARD.has(kind)) return 'ui_confirm';
  return 'cannon';
}
