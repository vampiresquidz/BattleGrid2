// Custom per-chip art. Each chip gets its own holographic "battlechip" portrait
// generated on a canvas: an element/class-themed backdrop, a radial glow, the
// chip's glyph embossed with neon, a foil sheen, a cut-corner neon frame, and
// rarity gems. Cached as a data URL per kind so it's drawn once and reused on the
// deck cards, the shop, the battle hand, and the hover tooltip.
import { CHIP_DEFS, maxCopiesOf, type ChipKind, type ChipClass } from './chips.ts';

// base (dark) + accent (neon) per class — the fallback theme
const CLASS_THEME: Record<ChipClass, [string, string]> = {
  strike:  ['#3a0a12', '#ff5a6e'],
  guard:   ['#0a2038', '#5ab0ff'],
  breach:  ['#260a3a', '#c46bff'],
  control: ['#07302e', '#42e8c0'],
  tempo:   ['#3a2c08', '#ffd24a'],
  support: ['#0a3018', '#5affa0'],
};
// element overrides so the fire/ice/wind/etc. families read at a glance
const KIND_THEME: Partial<Record<ChipKind, [string, string]>> = {
  flamecannon: ['#3a1004', '#ff8a3c'], volcano: ['#3a1004', '#ff7a3c'],
  iceshot: ['#08243f', '#9fe8ff'], blizzard: ['#08243f', '#bff2ff'], icewall: ['#08243f', '#9fe8ff'],
  galeshot: ['#063030', '#9fffd8'], cyclone: ['#063030', '#9fffd8'], windwall: ['#063030', '#9fffd8'], wind: ['#063030', '#9fffd8'],
  water: ['#052540', '#5fbdf0'], riptide: ['#052540', '#5fbdf0'],
  snake: ['#1a3008', '#b6ff5a'], leech: ['#2a0a1a', '#ff6aa0'], drain: ['#2a0a1a', '#ff6aa0'],
  bassgs: ['#1a0814', '#ff5a5a'], deltaray: ['#240a0a', '#ffd24a'], lifesword: ['#241a04', '#ffe79a'],
};

function themeFor(kind: ChipKind): [string, string] {
  return KIND_THEME[kind] ?? CLASS_THEME[CHIP_DEFS[kind].cls];
}

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
const S = 180;

function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
}

// gems: 0 = none (standard), draw 1 for mega, a crown-ish trio for giga
function drawRarity(g: CanvasRenderingContext2D, copies: number, frame: string) {
  const gems = copies <= 1 ? 3 : copies <= 2 ? 2 : 0; // giga(1)→3, mega(2)→2, std(4)→0
  if (!gems) return;
  const color = copies <= 1 ? '#ffd86b' : '#cdaaff';
  for (let i = 0; i < gems; i++) {
    const cx = S - 18 - i * 15, cy = 18;
    g.save();
    g.translate(cx, cy); g.rotate(Math.PI / 4);
    g.fillStyle = color; g.shadowColor = color; g.shadowBlur = 8;
    g.fillRect(-4, -4, 8, 8);
    g.restore();
  }
  void frame;
}

function drawArt(icon: string, a: string, b: string, copies: number): string {
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;

  // clip to the rounded panel
  roundRectPath(g, 4, 4, S - 8, S - 8, 16); g.save(); g.clip();

  // backdrop: vertical gradient, base color top → darker bottom
  const grad = g.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, a); grad.addColorStop(1, '#05060d');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);

  // radial accent glow
  const rg = g.createRadialGradient(S / 2, S * 0.46, 8, S / 2, S * 0.46, S * 0.62);
  rg.addColorStop(0, hexA(b, 0.55)); rg.addColorStop(1, hexA(b, 0));
  g.fillStyle = rg; g.fillRect(0, 0, S, S);

  // faint scanlines for the digital/holo feel
  g.globalAlpha = 0.06; g.fillStyle = '#ffffff';
  for (let y = 6; y < S; y += 6) g.fillRect(0, y, S, 1);
  g.globalAlpha = 1;

  // the glyph
  g.font = `108px ${EMOJI_FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = b; g.shadowBlur = 22;
  g.fillText(icon, S / 2, S / 2 + 4);
  g.shadowBlur = 0;

  // diagonal foil sheen
  g.globalAlpha = 0.10; g.fillStyle = '#ffffff';
  g.beginPath(); g.moveTo(-20, S * 0.2); g.lineTo(S * 0.45, -20); g.lineTo(S * 0.62, -20); g.lineTo(-20, S * 0.42); g.closePath(); g.fill();
  g.globalAlpha = 1;

  g.restore(); // un-clip

  // neon frame
  roundRectPath(g, 5, 5, S - 10, S - 10, 15);
  g.lineWidth = 5; g.strokeStyle = b; g.shadowColor = b; g.shadowBlur = 12; g.stroke();
  g.shadowBlur = 0;
  roundRectPath(g, 10, 10, S - 20, S - 20, 11);
  g.lineWidth = 1.5; g.strokeStyle = hexA('#ffffff', 0.35); g.stroke();

  drawRarity(g, copies, b);
  return c.toDataURL('image/png');
}

// "#rrggbb" + alpha → rgba()
function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const cache = new Map<string, string>();

export function chipArtURL(kind: ChipKind): string {
  let url = cache.get(kind);
  if (!url) {
    const [a, b] = themeFor(kind);
    url = drawArt(CHIP_DEFS[kind].icon, a, b, maxCopiesOf(kind));
    cache.set(kind, url);
  }
  return url;
}

// Program Advances aren't real chips — give them their own gold "fused" art.
export function paArtURL(id: string, icon: string): string {
  const key = 'pa:' + id;
  let url = cache.get(key);
  if (!url) { url = drawArt(icon, '#3a2a06', '#ffd86b', 0); cache.set(key, url); }
  return url;
}
