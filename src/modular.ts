// ---- Modular player character ----
// A fully procedural (canvas-drawn) chibi agent whose parts AND colours are
// independently swappable: armour frame / trim / outline / visor colours plus a
// HELMET style, a torso OUTFIT, and optional shoulder pads. Nothing is baked art,
// so it recolours and re-equips instantly and animates (idle / walk / battle).
//
// The whole config persists in localStorage; sprites.ts routes the 'custom' body
// archetype here, so the overworld, walk cycles, battle and the agent screen all
// render the same build automatically.

export type HelmetId = 'crest' | 'mohawk' | 'horns' | 'antenna' | 'hood' | 'bald';
export type OutfitId = 'armor' | 'jacket' | 'vest' | 'sash' | 'core';

export interface ModularConfig {
  frame: string;  // main armour
  trim: string;   // plates / highlights
  dark: string;   // outlines / faceplate
  eye: string;    // visor / energy glow
  helmet: HelmetId;
  outfit: OutfitId;
  shoulders: boolean;
}

export const HELMETS: Array<{ id: HelmetId; name: string }> = [
  { id: 'crest', name: 'Crest' }, { id: 'mohawk', name: 'Mohawk' }, { id: 'horns', name: 'Horns' },
  { id: 'antenna', name: 'Antenna' }, { id: 'hood', name: 'Hood' }, { id: 'bald', name: 'Bare' },
];
export const OUTFITS: Array<{ id: OutfitId; name: string }> = [
  { id: 'armor', name: 'Armour' }, { id: 'jacket', name: 'Jacket' }, { id: 'vest', name: 'Vest' },
  { id: 'sash', name: 'Sash' }, { id: 'core', name: 'Core' },
];

// curated swatches for the customizer (full <input type=color> is offered too)
export const SWATCHES = [
  '#9aa3ad', '#3f7ad8', '#d8483f', '#3fb56a', '#d9a93f', '#7a4fd8', '#e85d97', '#1fb6a6',
  '#cfe6f0', '#e8702a', '#2c2f36', '#ffffff', '#152848', '#0c0d10', '#67e0ff', '#ff5d5d',
  '#b6ff5d', '#ffe79a', '#cdf2ff', '#ff92e2',
];

export const DEFAULT_MODULAR: ModularConfig = {
  frame: '#3f7ad8', trim: '#9cc6ff', dark: '#152848', eye: '#cdf2ff',
  helmet: 'crest', outfit: 'armor', shoulders: true,
};

const KEY = 'abyssal.modular';

export function getModularConfig(): ModularConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') return { ...DEFAULT_MODULAR, ...raw };
  } catch { /* ignore */ }
  return { ...DEFAULT_MODULAR };
}
export function setModularConfig(cfg: ModularConfig): void {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

// -------------------------------------------------------------------------
// procedural renderer
// -------------------------------------------------------------------------
const S = 256; // logical cell size (one frame)

type View = 'front' | 'back' | 'side' | 'battle';
interface Pose { view: View; mirror?: boolean; legPhase?: number; cannon?: number; recoil?: number; flash?: number; melee?: number; }

// Draw one modular character into the cell whose left edge is at `ox`.
function drawModular(x: CanvasRenderingContext2D, ox: number, cfg: ModularConfig, pose: Pose): void {
  const { frame, trim, dark, eye } = cfg;
  const view = pose.view;
  const s = pose.legPhase ?? 0;
  const cannon = pose.cannon ?? 0;
  const recoil = pose.recoil ?? 0;
  const flash = pose.flash ?? 0;
  const melee = pose.melee ?? 0;
  const bob = -Math.abs(s) * 2;

  x.save();
  if (pose.mirror) { x.translate(2 * ox + S, 0); x.scale(-1, 1); } // mirror within this cell
  const O = ox - recoil * 6;

  const part = (px: number, py: number, w: number, h: number, r: number, fill: string, outline = true) => {
    x.beginPath(); x.roundRect(O + px, py + bob, w, h, r); x.fillStyle = fill; x.fill();
    if (outline) { x.lineWidth = 5; x.strokeStyle = dark; x.stroke(); }
    x.save(); x.beginPath(); x.roundRect(O + px, py + bob, w, h, r); x.clip();
    x.fillStyle = 'rgba(255,255,255,0.16)'; x.fillRect(O + px, py + bob, w, h * 0.4); x.restore();
  };
  const disc = (dx: number, dy: number, rad: number, fill: string, ring = true) => {
    x.beginPath(); x.arc(O + dx, dy + bob, rad, 0, Math.PI * 2); x.fillStyle = fill; x.fill();
    if (ring) { x.lineWidth = 4; x.strokeStyle = dark; x.stroke(); }
  };
  const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, fill: string, outline = true) => {
    x.beginPath(); x.moveTo(O + ax, ay + bob); x.lineTo(O + bx, by + bob); x.lineTo(O + cx, cy + bob); x.closePath();
    x.fillStyle = fill; x.fill(); if (outline) { x.lineWidth = 4; x.strokeStyle = dark; x.stroke(); }
  };

  // ---- legs / boots (walk stride) ----
  const liftL = Math.max(0, -s) * 7, liftR = Math.max(0, s) * 7;
  part(96, 188, 26, 34 - liftL, 8, frame);
  part(134, 188, 26, 34 - liftR, 8, frame);
  part(90, 214 - liftL, 34, 18, 7, trim);
  part(132, 214 - liftR, 34, 18, 7, trim);

  // ---- back arm (hidden on the far side in 'side') ----
  if (view !== 'side') part(70, 138, 24, 46, 11, frame);

  // ---- torso ----
  part(84, 130, 88, 64, 14, frame);
  drawOutfit(cfg.outfit, { part, disc, tri }, trim, dark, eye, view);

  // ---- shoulders ----
  if (cfg.shoulders) {
    disc(92, 132, 17, trim);
    if (view !== 'side') disc(164, 132, 17, trim);
  }

  // ---- front arm: fist (idle), arm-cannon (battle), or melee swing ----
  if (cannon > 0.05) {
    const len = 50 + cannon * 22;
    part(158, 142, len, 40, 18, frame);
    const muzz = 158 + len - 2;
    disc(muzz, 162, 21, dark);
    disc(muzz, 162, 11 + flash * 9, eye);
    disc(muzz, 162, 5 + flash * 6, '#ffffff', false);
  } else if (melee > 0.05) {
    x.save(); x.translate(O + 168, 150 + bob); x.rotate(-0.9 + melee * 1.8);
    x.beginPath(); x.roundRect(0, -20, 30 + melee * 24, 40, 14); x.fillStyle = frame; x.fill();
    x.lineWidth = 5; x.strokeStyle = dark; x.stroke(); x.restore();
    // slash arc
    x.save(); x.strokeStyle = eye; x.globalAlpha = 0.6 * melee; x.lineWidth = 8;
    x.beginPath(); x.arc(O + 176, 162 + bob, 44, -1.1, 0.7); x.stroke(); x.restore();
  } else {
    part(160, 146, 26, 44, 11, frame);
    disc(173, 192, 15, trim);
  }

  // ---- head + helmet + face ----
  part(74, 46, 108, 90, 30, frame);
  if (view === 'back') {
    // back of the head: a dark vent panel + a neck nub, no visor
    part(92, 70, 72, 46, 14, dark, false);
    x.save(); x.beginPath(); x.roundRect(O + 92, 70 + bob, 72, 46, 14); x.clip();
    x.fillStyle = trim; x.fillRect(O + 100, 78 + bob, 56, 8); x.fillRect(O + 100, 94 + bob, 56, 6); x.restore();
  } else {
    const sideShift = view === 'side' ? 12 : 0;
    part(90 + sideShift, 80, 76 - sideShift, 44, 14, dark, false);
    x.save(); x.beginPath(); x.roundRect(O + 90 + sideShift, 80 + bob, 76 - sideShift, 44, 14); x.clip();
    x.fillStyle = eye; x.fillRect(O + 96 + sideShift, 88 + bob, 64 - sideShift, 16);
    if (view === 'front') {
      x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillRect(O + 102, 90 + bob, 12, 12); x.fillRect(O + 134, 90 + bob, 12, 12);
    } else {
      x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillRect(O + 138, 90 + bob, 12, 12); // single eye glint, facing +x
    }
    x.restore();
  }
  drawHelmet(cfg.helmet, { part, disc, tri }, trim, dark, eye, view, bob, O, x);
  x.restore();
}

type Helpers = {
  part: (px: number, py: number, w: number, h: number, r: number, fill: string, outline?: boolean) => void;
  disc: (dx: number, dy: number, rad: number, fill: string, ring?: boolean) => void;
  tri: (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, fill: string, outline?: boolean) => void;
};

function drawOutfit(id: OutfitId, h: Helpers, trim: string, dark: string, eye: string, view: View) {
  const back = view === 'back';
  switch (id) {
    case 'armor':
      h.part(104, 138, 48, 30, 10, trim);
      if (!back) { h.disc(128, 153, 9, eye); h.disc(128, 153, 3.5, '#ffffff', false); }
      break;
    case 'jacket':
      if (!back) {
        h.tri(90, 130, 128, 140, 110, 192, dark);     // left lapel
        h.tri(166, 130, 128, 140, 146, 192, dark);    // right lapel
        h.part(118, 132, 20, 16, 5, trim);            // collar
      } else { h.part(96, 138, 64, 44, 10, dark, false); }
      break;
    case 'vest':
      h.tri(96, 132, 160, 132, 128, 186, trim);
      if (!back) { h.disc(128, 150, 7, eye); }
      break;
    case 'sash':
      h.part(92, 150, 84, 16, 6, trim);               // chest band
      if (!back) h.disc(150, 158, 8, eye);
      break;
    case 'core':
      if (!back) { h.disc(128, 158, 18, dark); h.disc(128, 158, 12, eye); h.disc(128, 158, 5, '#ffffff', false); }
      else h.part(108, 142, 40, 36, 12, dark, false);
      break;
  }
}

function drawHelmet(
  id: HelmetId, h: Helpers, trim: string, dark: string, eye: string,
  view: View, bob: number, O: number, x: CanvasRenderingContext2D,
) {
  switch (id) {
    case 'crest':
      h.tri(128, 30, 146, 54, 110, 54, trim);
      break;
    case 'mohawk':
      for (let i = 0; i < 5; i++) { const px = 96 + i * 16; h.tri(px, 22, px + 8, 46, px - 8, 46, trim); }
      break;
    case 'horns':
      h.tri(82, 52, 64, 18, 96, 46, trim); h.tri(174, 52, 192, 18, 160, 46, trim);
      break;
    case 'antenna':
      h.part(96, 18, 6, 30, 3, dark); h.disc(99, 16, 7, eye);
      h.part(154, 18, 6, 30, 3, dark); h.disc(157, 16, 7, eye);
      break;
    case 'hood': {
      // a rounded hood arc hugging the head (drawn directly for the curve)
      x.beginPath(); x.arc(O + 128, 92 + bob, 64, Math.PI * 1.08, Math.PI * 1.92);
      x.lineWidth = 22; x.strokeStyle = dark; x.lineCap = 'round'; x.stroke(); x.lineCap = 'butt';
      break;
    }
    case 'bald':
      // forehead light only
      h.disc(128, 56, 6, eye, false);
      break;
  }
  // ear discs frame the head (skip on side / back)
  if (view === 'front') {
    h.disc(74, 100, 16, trim); h.disc(74, 100, 6, eye, false);
    h.disc(182, 100, 16, trim); h.disc(182, 100, 6, eye, false);
  } else if (view === 'side') {
    h.disc(170, 100, 14, trim); h.disc(170, 100, 5, eye, false);
  }
}

// -------------------------------------------------------------------------
// canvas exporters (sprites.ts wraps these into THREE textures)
// -------------------------------------------------------------------------
type IdleView = 'front' | 'right' | 'back' | 'left' | 'battle';
const VIEW_MAP: Record<IdleView, { view: View; mirror: boolean }> = {
  front: { view: 'front', mirror: false },
  right: { view: 'side', mirror: false },
  left: { view: 'side', mirror: true },
  back: { view: 'back', mirror: false },
  battle: { view: 'battle', mirror: false },
};

export function modularIdleCanvas(view: IdleView, cfg: ModularConfig): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d')!; x.imageSmoothingEnabled = false; x.setTransform(2, 0, 0, 2, 0, 0); // 256→512
  const v = VIEW_MAP[view];
  drawModular(x, 0, cfg, { view: v.view, mirror: v.mirror });
  return c;
}

export type WalkDir = 'down' | 'up' | 'left' | 'right';
const WALK_VIEW: Record<WalkDir, { view: View; mirror: boolean }> = {
  down: { view: 'front', mirror: false }, up: { view: 'back', mirror: false },
  left: { view: 'side', mirror: true }, right: { view: 'side', mirror: false },
};
export function modularWalkCanvas(dir: WalkDir, cfg: ModularConfig, frames: number): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.height = 512; c.width = 512 * frames;
  const x = c.getContext('2d')!; x.imageSmoothingEnabled = false; x.setTransform(2, 0, 0, 2, 0, 0);
  const v = WALK_VIEW[dir];
  for (let i = 0; i < frames; i++) {
    drawModular(x, i * S, cfg, { view: v.view, mirror: v.mirror, legPhase: Math.sin((i / frames) * Math.PI * 2) });
  }
  return c;
}

export type BattleKind = 'idle' | 'atk' | 'melee';
export function modularBattleCanvas(kind: BattleKind, cfg: ModularConfig, frames: number): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.height = 512; c.width = 512 * frames;
  const x = c.getContext('2d')!; x.imageSmoothingEnabled = false; x.setTransform(2, 0, 0, 2, 0, 0);
  for (let i = 0; i < frames; i++) {
    const t = frames > 1 ? i / (frames - 1) : 0;
    if (kind === 'idle') drawModular(x, i * S, cfg, { view: 'battle', legPhase: Math.sin((i / frames) * Math.PI * 2) * 0.25 });
    else if (kind === 'atk') drawModular(x, i * S, cfg, { view: 'battle', cannon: 0.5 + 0.5 * t, recoil: t > 0.5 ? (t - 0.5) * 2 : 0, flash: t > 0.4 && t < 0.8 ? 1 : 0.2 });
    else drawModular(x, i * S, cfg, { view: 'battle', melee: Math.sin(t * Math.PI) });
  }
  return c;
}
