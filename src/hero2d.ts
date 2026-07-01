// ---- 2D modular pixel hero (gpt-image-1, true part swap) ----
// An original cyber-RONIN built from SEPARATE pixel-art PARTS composited on a
// shared frame: a simple HEADLESS body (front + 3/4 battle view) + a swappable
// HEAD part (visor / hood / oni), each drawn per view and bottom-aligned to the
// body's neck. Recoloured live with a canvas hue rotation. This renders the
// in-game 'custom' agent in the overworld AND in battle.
import * as THREE from 'three';

export interface HeroConfig { head: string; hue: number }

// swappable HEAD parts (each has a front `_f` and a 3/4 battle `_b` sprite)
export const HEADS: Array<{ id: string; name: string }> = [
  { id: 'visor', name: 'Visor' },
  { id: 'hood', name: 'Hood' },
  { id: 'oni', name: 'Oni' },
];
const BODY_FRONT = '/sprites/hero2d/body_front.png';
const BODY_BATTLE = '/sprites/hero2d/body_battle.png';
const headSrc = (id: string, view: 'f' | 'b') => `/sprites/hero2d/head_${id}_${view}.png`;

// where the head's neck bottom sits (centre-x, neck-y) + target head width, per view
const FRONT_NECK = { cx: 256, neckY: 150, w: 100 };
const BATTLE_NECK = { cx: 232, neckY: 156, w: 104 };

const KEY = 'abyssal.hero2d';
export const DEFAULT_HERO: HeroConfig = { head: 'visor', hue: 0 };

export function getHeroConfig(): HeroConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const c = { ...DEFAULT_HERO, ...raw } as HeroConfig & { helmet?: string };
      if (c.helmet && !raw.head) c.head = c.helmet === 'default' ? 'visor' : c.helmet; // migrate old config
      return { head: c.head, hue: c.hue };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_HERO };
}
export function setHeroConfig(cfg: HeroConfig): void {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

// ---- async image cache (refresh textures when a part lands) ----
const _imgs = new Map<string, HTMLImageElement>();
const _waiters = new Map<string, Array<() => void>>();
function img(src: string): HTMLImageElement {
  let i = _imgs.get(src);
  if (!i) { i = new Image(); i.onload = () => { const w = _waiters.get(src); if (w) for (const f of w.splice(0)) f(); }; i.src = src; _imgs.set(src, i); }
  return i;
}
function onReady(srcs: string[], f: () => void) {
  let pending = 0;
  for (const s of srcs) {
    const i = img(s);
    if (i.complete && i.naturalWidth) continue;
    pending++;
    const w = _waiters.get(s) ?? []; w.push(() => { if (--pending <= 0) f(); }); _waiters.set(s, w);
  }
  if (pending === 0) f();
}

// trimmed opaque bbox of an image (cached)
const _bbox = new Map<string, { x: number; y: number; w: number; h: number }>();
function trimBox(im: HTMLImageElement) {
  let b = _bbox.get(im.src);
  if (b) return b;
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const g = c.getContext('2d')!; g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  b = x1 >= x0 ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : { x: 0, y: 0, w: c.width, h: c.height };
  _bbox.set(im.src, b); return b;
}

// draw a head part centred at anchor.cx with its bottom on anchor.neckY
function drawHead(x: CanvasRenderingContext2D, ox: number, id: string, view: 'f' | 'b', a: { cx: number; neckY: number; w: number }, off = { dx: 0, dy: 0 }) {
  const im = img(headSrc(id, view));
  if (!im.complete || !im.naturalWidth) return;
  const bb = trimBox(im); const s = a.w / bb.w;
  const dw = bb.w * s, dh = bb.h * s;
  x.drawImage(im, bb.x, bb.y, bb.w, bb.h, ox + a.cx - dw / 2 + off.dx, a.neckY - dh + off.dy, dw, dh);
}

function srcsForView(cfg: HeroConfig, view: 'f' | 'b'): string[] {
  return [view === 'f' ? BODY_FRONT : BODY_BATTLE, headSrc(cfg.head, view)];
}

// ---- front (overworld) ----
function drawFront(x: CanvasRenderingContext2D, ox: number, cfg: HeroConfig, bob = 0) {
  const body = img(BODY_FRONT);
  if (body.complete && body.naturalWidth) x.drawImage(body, ox, bob, 512, 512);
  drawHead(x, ox, cfg.head, 'f', FRONT_NECK, { dx: 0, dy: bob });
}

export function heroCanvas(cfg: HeroConfig): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d')!; x.imageSmoothingEnabled = false; x.filter = `hue-rotate(${cfg.hue || 0}deg)`;
  drawFront(x, 0, cfg);
  return c;
}
export function heroStripCanvas(cfg: HeroConfig, frames: number, amp = 8): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 512 * frames; c.height = 512;
  const x = c.getContext('2d')!; x.imageSmoothingEnabled = false; x.filter = `hue-rotate(${cfg.hue || 0}deg)`;
  for (let i = 0; i < frames; i++) drawFront(x, i * 512, cfg, -Math.abs(Math.sin((i / frames) * Math.PI * 2)) * amp);
  return c;
}

// ---- battle (three-quarter, faces +x) ----
export type BattleKind = 'idle' | 'atk' | 'melee';
const MUZZLE = { x: 420, y: 130 }; // blaster muzzle in the battle frame (fire flash)

function drawBattle(x: CanvasRenderingContext2D, ox: number, cfg: HeroConfig, o: { bob?: number; dx?: number; flash?: number; slash?: number }) {
  const dx = o.dx ?? 0, bob = o.bob ?? 0;
  const body = img(BODY_BATTLE);
  if (body.complete && body.naturalWidth) x.drawImage(body, ox + dx, bob, 512, 512);
  drawHead(x, ox, cfg.head, 'b', BATTLE_NECK, { dx, dy: bob });
  if (o.flash) {
    const cx = ox + dx + MUZZLE.x, cy = MUZZLE.y + bob, r = 14 + o.flash * 18;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.4, 'rgba(120,240,255,0.8)'); g.addColorStop(1, 'rgba(120,240,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  }
  if (o.slash) {
    const cx = ox + dx + 360, cy = 250 + bob;
    x.save(); x.strokeStyle = 'rgba(150,240,255,' + (0.7 * o.slash).toFixed(2) + ')'; x.lineWidth = 10;
    x.beginPath(); x.arc(cx, cy, 90 + o.slash * 20, -1.1, 0.7); x.stroke(); x.restore();
  }
}

export function heroBattleCanvas(cfg: HeroConfig, kind: BattleKind, frames: number): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = 512 * frames; c.height = 512;
  const x = c.getContext('2d')!; x.imageSmoothingEnabled = false; x.filter = `hue-rotate(${cfg.hue || 0}deg)`;
  for (let i = 0; i < frames; i++) {
    const t = frames > 1 ? i / (frames - 1) : 0; const s = Math.sin(t * Math.PI);
    if (kind === 'idle') drawBattle(x, i * 512, cfg, { bob: -Math.abs(Math.sin((i / frames) * Math.PI * 2)) * 6 });
    else if (kind === 'atk') drawBattle(x, i * 512, cfg, { dx: -s * 6, flash: t > 0.2 && t < 0.7 ? 1 : 0.12 });
    else drawBattle(x, i * 512, cfg, { dx: s * 12, slash: s });
  }
  return c;
}

function pixelTex(c: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.anisotropy = 4;
  return t;
}

export function heroTexture(cfg: HeroConfig): THREE.Texture {
  const t = pixelTex(heroCanvas(cfg));
  onReady(srcsForView(cfg, 'f'), () => { t.image = heroCanvas(cfg); t.needsUpdate = true; });
  return t;
}
export function heroStripTexture(cfg: HeroConfig, frames: number, amp = 8): THREE.Texture {
  const t = pixelTex(heroStripCanvas(cfg, frames, amp));
  onReady(srcsForView(cfg, 'f'), () => { t.image = heroStripCanvas(cfg, frames, amp); t.needsUpdate = true; });
  return t;
}
export function heroBattleTexture(cfg: HeroConfig, kind: BattleKind, frames: number): THREE.Texture {
  const t = pixelTex(heroBattleCanvas(cfg, kind, frames));
  onReady(srcsForView(cfg, 'b'), () => { t.image = heroBattleCanvas(cfg, kind, frames); t.needsUpdate = true; });
  return t;
}
