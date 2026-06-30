import * as THREE from 'three';

// Real character art generated with gpt-image-1 (see tools/genimg.py), served
// from /public/sprites. Loaded as textures with crisp magnification so the
// pixel-art look survives. Swap the URLs to add more characters.

const loader = new THREE.TextureLoader();

function loadPixel(url: string): THREE.Texture {
  const apply = (t: THREE.Texture) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.anisotropy = 4;
    t.needsUpdate = true;
  };
  const tex = loader.load(url, apply);
  apply(tex);
  return tex;
}

export const textures = {
  diver: () => loadPixel('/sprites/player_diver.png'),
  angler: () => loadPixel('/sprites/enemy_angler.png'),
  crab: () => loadPixel('/sprites/enemy_crab.png'),
  shark: () => loadPixel('/sprites/enemy_shark.png'),
  mermaid: () => loadPixel('/sprites/ally_mermaid.png'),
  // Italian brainrot meme battlers
  goblinmonkey: () => loadPixel('/sprites/meme_goblinmonkey.png'),
  tungtung: () => loadPixel('/sprites/meme_tungtung.png'),
  tralalero: () => loadPixel('/sprites/meme_tralalero.png'),
  bombardiro: () => loadPixel('/sprites/meme_bombardiro.png'),
  ballerina: () => loadPixel('/sprites/meme_ballerina.png'),
  // attack-pose frames (swapped in for the lunge); generated via tools/editimg.py
  goblinmonkeyAtk: () => loadPixel('/sprites/meme_goblinmonkey_attack.png'),
  tungtungAtk: () => loadPixel('/sprites/meme_tungtung_attack.png'),
  tralaleroAtk: () => loadPixel('/sprites/meme_tralalero_attack.png'),
  bombardiroAtk: () => loadPixel('/sprites/meme_bombardiro_attack.png'),
  ballerinaAtk: () => loadPixel('/sprites/meme_ballerina_attack.png'),
  anglerAtk: () => loadPixel('/sprites/enemy_angler_attack.png'),
  crabAtk: () => loadPixel('/sprites/enemy_crab_attack.png'),
  // rogue-AI process enemies
  hallucination: () => loadPixel('/sprites/enemy_hallucination.png'),
  hallucinationAtk: () => loadPixel('/sprites/enemy_hallucination_attack.png'),
  daemon: () => loadPixel('/sprites/enemy_daemon.png'),
  daemonAtk: () => loadPixel('/sprites/enemy_daemon_attack.png'),
  trainer: () => loadPixel('/sprites/enemy_trainer.png'),
  trainerAtk: () => loadPixel('/sprites/enemy_trainer_attack.png'),
  crawler: () => loadPixel('/sprites/enemy_crawler.png'),
  crawlerAtk: () => loadPixel('/sprites/enemy_crawler_attack.png'),
  // rat mob — made with the genimg → pixelsnap pixel-art pipeline
  packetrat: () => loadPixel('/sprites/enemy_packetrat.png'),
  packetratAtk: () => loadPixel('/sprites/enemy_packetrat_attack.png'),
  plaguerat: () => loadPixel('/sprites/enemy_plaguerat.png'),
  plagueratAtk: () => loadPixel('/sprites/enemy_plaguerat_attack.png'),
  ratking: () => loadPixel('/sprites/enemy_ratking.png'),
  ratkingAtk: () => loadPixel('/sprites/enemy_ratking_attack.png'),
  // Seedance-baked frame strips (square cells) — see tools/seedance.py
  goblinIdleSheet: () => loadPixel('/sprites/anim_goblin_idle.png'),
  goblinAttackSheet: () => loadPixel('/sprites/anim_goblin_attack.png'),
  goblinBlasterSheet: () => loadPixel('/sprites/anim_goblin_blaster.png'),
  goblinHurtSheet: () => loadPixel('/sprites/anim_goblin_hurt.png'),
  goblinVictorySheet: () => loadPixel('/sprites/anim_goblin_victory.png'),
  // Seedance-baked enemy idle/attack strips (square cells)
  tralaleroIdleSheet: () => loadPixel('/sprites/anim_tralalero_idle.png'),
  tralaleroAtkSheet: () => loadPixel('/sprites/anim_tralalero_attack.png'),
  tungtungIdleSheet: () => loadPixel('/sprites/anim_tungtung_idle.png'),
  tungtungAtkSheet: () => loadPixel('/sprites/anim_tungtung_attack.png'),
  anglerIdleSheet: () => loadPixel('/sprites/anim_angler_idle.png'),
  anglerAtkSheet: () => loadPixel('/sprites/anim_angler_attack.png'),
  ballerinaIdleSheet: () => loadPixel('/sprites/anim_ballerina_idle.png'),
  ballerinaAtkSheet: () => loadPixel('/sprites/anim_ballerina_attack.png'),
  bombardiroIdleSheet: () => loadPixel('/sprites/anim_bombardiro_idle.png'),
  bombardiroAtkSheet: () => loadPixel('/sprites/anim_bombardiro_attack.png'),
  crabIdleSheet: () => loadPixel('/sprites/anim_crab_idle.png'),
  crabAtkSheet: () => loadPixel('/sprites/anim_crab_attack.png'),
  hallucinationIdleSheet: () => loadPixel('/sprites/anim_hallucination_idle.png'),
  hallucinationAtkSheet: () => loadPixel('/sprites/anim_hallucination_attack.png'),
  daemonIdleSheet: () => loadPixel('/sprites/anim_daemon_idle.png'),
  daemonAtkSheet: () => loadPixel('/sprites/anim_daemon_attack.png'),
  trainerIdleSheet: () => loadPixel('/sprites/anim_trainer_idle.png'),
  trainerAtkSheet: () => loadPixel('/sprites/anim_trainer_attack.png'),
  crawlerIdleSheet: () => loadPixel('/sprites/anim_crawler_idle.png'),
  crawlerAtkSheet: () => loadPixel('/sprites/anim_crawler_attack.png'),
  // 4-direction overworld walk strips
  goblinWalkDown: () => loadPixel('/sprites/anim_goblin_walk_down.png'),
  goblinWalkUp: () => loadPixel('/sprites/anim_goblin_walk_up.png'),
  goblinWalkLeft: () => loadPixel('/sprites/anim_goblin_walk_left.png'),
  goblinWalkRight: () => loadPixel('/sprites/anim_goblin_walk_right.png'),
  // alien digital-planet overworld environment
  alienGround: () => loadPixel('/sprites/world_alien_ground.png'),
  alienCliff: () => { const t = loadPixel('/sprites/world_alien_cliff.png'); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; },
  alienSky: () => loadPixel('/sprites/world_alien_sky.png'),
  crystal: () => loadPixel('/sprites/world_crystal.png'),
  spire: () => loadPixel('/sprites/world_spire.png'),
  alienFlora: () => loadPixel('/sprites/world_alienflora.png'),
  // overworld
  seabed: () => loadPixel('/sprites/world_seabed.png'),
  coral: () => loadPixel('/sprites/world_coral.png'),
  kelp: () => loadPixel('/sprites/world_kelp.png'),
};

// ---- Battle panel textures ----
// A shaded, beveled tile surface plus a matching emissive map so only the
// neon border + emblem glow (the HD-2D look). One scheme per side.
export interface PanelTex { map: THREE.Texture; emissive: THREE.Texture; }

function hexa(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function panelTextures(player: boolean): PanelTex {
  const base = player ? '#235864' : '#4a2750';
  const light = player ? '#3f8a96' : '#7a4a80';
  const dark = player ? '#0c2228' : '#180820';
  const accent = player ? '#5cead6' : '#ff8fb0';
  const S = 128, m = 14, cx = S / 2;

  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d')!;

  // overall bevel gradient (light top-left -> dark bottom-right)
  const g = x.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, light); g.addColorStop(0.5, base); g.addColorStop(1, dark);
  x.fillStyle = g; x.fillRect(0, 0, S, S);

  // inset inner panel
  x.fillStyle = base;
  x.beginPath(); x.roundRect(m, m, S - 2 * m, S - 2 * m, 10); x.fill();

  // inner bevel: top-left highlight, bottom-right shadow
  x.lineWidth = 3; x.lineCap = 'round';
  x.strokeStyle = light;
  x.beginPath(); x.moveTo(m + 1, S - m); x.lineTo(m + 1, m + 1); x.lineTo(S - m, m + 1); x.stroke();
  x.strokeStyle = dark;
  x.beginPath(); x.moveTo(S - m - 1, m); x.lineTo(S - m - 1, S - m - 1); x.lineTo(m, S - m - 1); x.stroke();

  // faint center emblem (diamond)
  x.strokeStyle = hexa(accent, 0.35); x.lineWidth = 2;
  x.beginPath();
  x.moveTo(cx, cx - 12); x.lineTo(cx + 12, cx); x.lineTo(cx, cx + 12); x.lineTo(cx - 12, cx); x.closePath();
  x.stroke();

  // corner bolts
  const bolt = (bx: number, by: number) => {
    x.fillStyle = dark; x.beginPath(); x.arc(bx, by, 4, 0, Math.PI * 2); x.fill();
    x.fillStyle = light; x.beginPath(); x.arc(bx - 1, by - 1, 1.6, 0, Math.PI * 2); x.fill();
  };
  bolt(m + 7, m + 7); bolt(S - m - 7, m + 7); bolt(m + 7, S - m - 7); bolt(S - m - 7, S - m - 7);

  // neon border
  x.lineWidth = 4; x.strokeStyle = accent; x.strokeRect(5, 5, S - 10, S - 10);

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;

  // emissive map: black everywhere except the glowing parts
  const e = document.createElement('canvas'); e.width = e.height = S;
  const ex = e.getContext('2d')!;
  ex.fillStyle = '#000'; ex.fillRect(0, 0, S, S);
  ex.lineWidth = 5; ex.strokeStyle = accent; ex.strokeRect(5, 5, S - 10, S - 10);
  ex.strokeStyle = hexa(accent, 0.6); ex.lineWidth = 2;
  ex.beginPath();
  ex.moveTo(cx, cx - 12); ex.lineTo(cx + 12, cx); ex.lineTo(cx, cx + 12); ex.lineTo(cx - 12, cx); ex.closePath();
  ex.stroke();
  const emissive = new THREE.CanvasTexture(e);
  emissive.colorSpace = THREE.SRGBColorSpace;

  return { map, emissive };
}

// A damaged "cracked" panel surface (shared by both sides). Dim, no neon,
// jagged fracture lines with a faint warning-orange glow in the cracks.
export function panelCrackedTextures(): PanelTex {
  const S = 128, cx = S / 2;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, '#2a2620'); g.addColorStop(1, '#14110d');
  x.fillStyle = g; x.fillRect(0, 0, S, S);

  // fracture lines radiating from center
  const cracks: Array<[number, number, number, number]> = [
    [cx, cx, 16, 14], [cx, cx, 110, 30], [cx, cx, 30, 118], [cx, cx, 118, 100], [cx, cx, 8, 96],
  ];
  x.strokeStyle = '#0a0806'; x.lineWidth = 4; x.lineCap = 'round';
  for (const [x0, y0, x1, y1] of cracks) { x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke(); }
  x.strokeStyle = hexa('#ff7a2a', 0.55); x.lineWidth = 1.5;
  for (const [x0, y0, x1, y1] of cracks) { x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke(); }
  x.strokeStyle = '#3a342c'; x.lineWidth = 3; x.strokeRect(6, 6, S - 12, S - 12);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;

  const e = document.createElement('canvas'); e.width = e.height = S;
  const ex = e.getContext('2d')!;
  ex.fillStyle = '#000'; ex.fillRect(0, 0, S, S);
  ex.strokeStyle = hexa('#ff7a2a', 0.7); ex.lineWidth = 2.5;
  for (const [x0, y0, x1, y1] of cracks) { ex.beginPath(); ex.moveTo(x0, y0); ex.lineTo(x1, y1); ex.stroke(); }
  const emissive = new THREE.CanvasTexture(e); emissive.colorSpace = THREE.SRGBColorSpace;
  return { map, emissive };
}

// A glowing orb texture for projectiles / effects (radial gradient).
export function orbTexture(inner: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, inner);
  g.addColorStop(0.5, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- Procedural agent ("Mega Man"-style chibi robot) ----
// The base playable character is generated on canvas so we can recolor it into a
// whole roster without new art. `body` = main armour, `trim` = highlights/plates,
// `dark` = outlines/faceplate, `eye` = glowing visor/lights.
export interface RobotPalette { body: string; trim: string; dark: string; eye: string; }

// per-frame pose knobs so one drawing animates: cannon 0..1 (fist→arm-cannon),
// legPhase -1..1 (walk stride), recoil 0..1 (cannon kick), flash 0..1 (muzzle).
interface RobotPose { cannon?: number; legPhase?: number; recoil?: number; flash?: number; }

const ROBOT_S = 256; // logical cell size (one frame)

// Draw the agent into one cell whose left edge is at `ox`. All coords are local
// to a 256² cell; `ox` lets us tile frames side-by-side into a sprite strip.
function drawRobot(x: CanvasRenderingContext2D, ox: number, p: RobotPose & { pal: RobotPalette }): void {
  const pal = p.pal;
  const cannon = p.cannon ?? 0;
  const s = p.legPhase ?? 0;
  const recoil = p.recoil ?? 0;
  const flash = p.flash ?? 0;
  const O = ox - recoil * 6;           // whole-body recoil shove (faces +x, kicks -x)
  const bob = -Math.abs(s) * 2;        // subtle walk bob

  const part = (px: number, py: number, w: number, h: number, r: number, fill: string, outline = true) => {
    x.beginPath(); x.roundRect(O + px, py + bob, w, h, r); x.fillStyle = fill; x.fill();
    if (outline) { x.lineWidth = 5; x.strokeStyle = pal.dark; x.stroke(); }
    x.save(); x.beginPath(); x.roundRect(O + px, py + bob, w, h, r); x.clip();
    x.fillStyle = 'rgba(255,255,255,0.16)'; x.fillRect(O + px, py + bob, w, h * 0.4); x.restore();
  };
  const disc = (dx: number, dy: number, rad: number, fill: string, ring = true) => {
    x.beginPath(); x.arc(O + dx, dy + bob, rad, 0, Math.PI * 2); x.fillStyle = fill; x.fill();
    if (ring) { x.lineWidth = 4; x.strokeStyle = pal.dark; x.stroke(); }
  };

  // legs / boots — alternate foot lift for a walk cycle
  const liftL = Math.max(0, -s) * 7, liftR = Math.max(0, s) * 7;
  part(96, 188, 26, 34 - liftL, 8, pal.body);
  part(134, 188, 26, 34 - liftR, 8, pal.body);
  part(90, 214 - liftL, 34, 18, 7, pal.trim);
  part(132, 214 - liftR, 34, 18, 7, pal.trim);

  // back arm
  part(70, 138, 24, 46, 11, pal.body);

  // torso + chest core + shoulders
  part(84, 130, 88, 64, 14, pal.body);
  part(104, 138, 48, 30, 10, pal.trim);
  disc(128, 153, 9, pal.eye); disc(128, 153, 3.5, '#ffffff', false);
  disc(92, 132, 17, pal.trim); disc(164, 132, 17, pal.trim);

  // front arm: fist (idle) or extending arm-cannon (attack), pointing +x
  if (cannon > 0.05) {
    const len = 50 + cannon * 22;
    part(158, 142, len, 40, 18, pal.body);
    const muzz = 158 + len - 2;
    disc(muzz, 162, 21, pal.dark);
    disc(muzz, 162, 11 + flash * 9, pal.eye);
    disc(muzz, 162, 5 + flash * 6, '#ffffff', false);
  } else {
    part(160, 146, 26, 44, 11, pal.body);
    disc(173, 192, 15, pal.trim);
  }

  // head / helmet
  part(74, 46, 108, 90, 30, pal.body);
  x.beginPath(); x.moveTo(O + 128, 30 + bob); x.lineTo(O + 146, 54 + bob); x.lineTo(O + 110, 54 + bob); x.closePath();
  x.fillStyle = pal.trim; x.fill(); x.lineWidth = 4; x.strokeStyle = pal.dark; x.stroke();
  part(90, 80, 76, 44, 14, pal.dark, false);
  x.save(); x.beginPath(); x.roundRect(O + 90, 80 + bob, 76, 44, 14); x.clip();
  x.fillStyle = pal.eye; x.fillRect(O + 96, 88 + bob, 64, 16);
  x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillRect(O + 102, 90 + bob, 12, 12); x.fillRect(O + 134, 90 + bob, 12, 12);
  x.restore();
  disc(74, 100, 16, pal.trim); disc(74, 100, 6, pal.eye, false);
  disc(182, 100, 16, pal.trim); disc(182, 100, 6, pal.eye, false);
}

export function robotCanvas(pal: RobotPalette, attack = false): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = ROBOT_S;
  drawRobot(c.getContext('2d')!, 0, { pal, cannon: attack ? 1 : 0, flash: attack ? 0.6 : 0 });
  return c;
}

// horizontal sprite strip of `frames` walk poses (alternating stride)
export function robotWalkCanvas(pal: RobotPalette, frames = 6): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = ROBOT_S * frames; c.height = ROBOT_S;
  const x = c.getContext('2d')!;
  for (let i = 0; i < frames; i++) drawRobot(x, i * ROBOT_S, { pal, legPhase: Math.sin((i / frames) * Math.PI * 2) });
  return c;
}

// arm-cannon attack: charge → blast → recoil → settle
export function robotAttackCanvas(pal: RobotPalette): HTMLCanvasElement {
  const seq: RobotPose[] = [
    { cannon: 0.5, recoil: 0, flash: 0 },
    { cannon: 0.9, recoil: 0, flash: 0.1 },
    { cannon: 1, recoil: 0.3, flash: 1 },
    { cannon: 1, recoil: 1, flash: 0.5 },
    { cannon: 0.85, recoil: 0.3, flash: 0.2 },
  ];
  const c = document.createElement('canvas'); c.width = ROBOT_S * seq.length; c.height = ROBOT_S;
  const x = c.getContext('2d')!;
  seq.forEach((pose, i) => drawRobot(x, i * ROBOT_S, { pal, ...pose }));
  return c;
}

function pixelTex(c: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.anisotropy = 4;
  return t;
}

export function robotTexture(pal: RobotPalette, attack = false): THREE.Texture { return pixelTex(robotCanvas(pal, attack)); }
export function robotWalkTexture(pal: RobotPalette, frames = 6): THREE.Texture { return pixelTex(robotWalkCanvas(pal, frames)); }
export const ROBOT_WALK_FRAMES = 6;
export const ROBOT_ATTACK_FRAMES = 5;
export function robotAttackTexture(pal: RobotPalette): THREE.Texture { return pixelTex(robotAttackCanvas(pal)); }

// ---- Humanoid agent (gpt-image-1 bases, recolored per character) ----
// Hand-generated Mega Man X-style pixel sprites — one per view (front/right/back
// idle + a battle stance); LEFT is RIGHT mirrored. Each is tinted per character
// with a 'color' blend so every shell keeps the shading but a distinct armour hue.
// Images load lazily; canvases/textures refresh when they land.
export type AgentView = 'front' | 'right' | 'back' | 'left' | 'battle';
// Body archetype / "chassis" — a whole different sprite set you can pick in the
// agent screen. Each one is recolored per character by the same tint pipeline.
export type AgentBody = 'humanoid' | 'monkey' | 'evilbot' | 'cortex' | 'goblin';

type ViewMap = Record<AgentView, { src: string; mirror: boolean }>;

const AGENT_BODIES: Record<AgentBody, ViewMap> = {
  humanoid: {
    front:  { src: '/sprites/agent_base.png',       mirror: false },
    right:  { src: '/sprites/agent_base_right.png',  mirror: false },
    back:   { src: '/sprites/agent_base_back.png',   mirror: false },
    left:   { src: '/sprites/agent_base_right.png',  mirror: true },  // mirror of right
    battle: { src: '/sprites/agent_battle.png',      mirror: false }, // already faces +x (toward foe)
  },
  monkey: {
    front:  { src: '/sprites/monkey_base.png',   mirror: false },
    right:  { src: '/sprites/monkey_right.png',  mirror: false },
    back:   { src: '/sprites/monkey_back.png',   mirror: false },
    left:   { src: '/sprites/monkey_right.png',  mirror: true },
    battle: { src: '/sprites/monkey_battle.png', mirror: false },
  },
  evilbot: {
    front:  { src: '/sprites/robot_base.png',   mirror: false },
    right:  { src: '/sprites/robot_right.png',  mirror: false },
    back:   { src: '/sprites/robot_back.png',   mirror: false },
    left:   { src: '/sprites/robot_right.png',  mirror: true },
    battle: { src: '/sprites/robot_battle.png', mirror: false },
  },
  cortex: {
    front:  { src: '/sprites/cortex_base.png',   mirror: false },
    right:  { src: '/sprites/cortex_right.png',  mirror: false },
    back:   { src: '/sprites/cortex_back.png',   mirror: false },
    left:   { src: '/sprites/cortex_right.png',  mirror: true },
    battle: { src: '/sprites/cortex_battle.png', mirror: false },
  },
  // pixel-art goblin (genimg → pixelsnap workflow)
  goblin: {
    front:  { src: '/sprites/goblin_base.png',   mirror: false },
    right:  { src: '/sprites/goblin_right.png',  mirror: false },
    back:   { src: '/sprites/goblin_back.png',   mirror: false },
    left:   { src: '/sprites/goblin_right.png',  mirror: true },
    battle: { src: '/sprites/goblin_battle.png', mirror: false },
  },
};

const _imgCache = new Map<string, HTMLImageElement>();
const _imgWaiters = new Map<string, Array<() => void>>();
function loadImg(src: string): HTMLImageElement {
  let img = _imgCache.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => { const w = _imgWaiters.get(src); if (w) for (const f of w.splice(0)) f(); };
    img.src = src;
    _imgCache.set(src, img);
  }
  return img;
}
function onImg(src: string, f: () => void) {
  const img = loadImg(src);
  if (img.complete && img.naturalWidth) f();
  else { const w = _imgWaiters.get(src) ?? []; w.push(f); _imgWaiters.set(src, w); }
}

const AGENT_PX = 128; // logical pixel resolution — snaps the art to a chunky grid

function paintHumanoid(c: HTMLCanvasElement, body: AgentBody, view: AgentView, color: string, strength: number) {
  const { src, mirror } = AGENT_BODIES[body][view];
  const render = () => {
    const img = loadImg(src);
    const S = c.width;
    const x = c.getContext('2d')!;
    x.clearRect(0, 0, S, S);

    // pixelate: average down to a small grid, then blow back up with no smoothing
    // so the sprite reads as a crisp 2D pixel character inside the 3D world.
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = AGENT_PX;
    const tx = tmp.getContext('2d')!;
    tx.imageSmoothingEnabled = true;
    if (mirror) { tx.translate(AGENT_PX, 0); tx.scale(-1, 1); }
    tx.drawImage(img, 0, 0, AGENT_PX, AGENT_PX);
    x.imageSmoothingEnabled = false;
    x.drawImage(tmp, 0, 0, S, S);

    if (color && strength > 0) {
      x.globalCompositeOperation = 'color';   // recolor: keep luma, take this hue
      x.globalAlpha = strength;
      x.fillStyle = color; x.fillRect(0, 0, S, S);
      x.globalAlpha = 1;
      x.globalCompositeOperation = 'destination-in'; // re-clip to the pixelated alpha
      x.imageSmoothingEnabled = false;
      x.drawImage(tmp, 0, 0, S, S);
      x.globalCompositeOperation = 'source-over';
    }
  };
  onImg(src, render);
}

// strength is low by default: the dark base already carries the magenta/cyan glitch
// signature, so we only wash the armour with the character's hue and let the neon
// accents bleed through rather than recolouring them away.
export function humanoidCanvas(color: string, view: AgentView = 'front', strength = 0.45, body: AgentBody = 'humanoid'): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  paintHumanoid(c, body, view, color, strength);
  return c;
}

export function humanoidTexture(color: string, view: AgentView = 'front', strength = 0.45, body: AgentBody = 'humanoid'): THREE.Texture {
  const c = humanoidCanvas(color, view, strength, body);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.anisotropy = 4;
  onImg(AGENT_BODIES[body][view].src, () => { t.needsUpdate = true; });
  return t;
}

// --- walk-cycle strips (puppet-animated, baked by tools/bake_walk.py) ---
// Frame-by-frame walking: each chassis/direction is a horizontal N-frame strip
// of the dark base art; the same recolor pipeline tints it. SpriteAnim cycles
// the cells. left has its own pre-mirrored strip so frame offsets stay simple.
export type WalkDir = 'down' | 'up' | 'left' | 'right';
export const WALK_FRAMES = 6;
const WALK_SRC: Record<AgentBody, Record<WalkDir, string>> = {
  humanoid: { down: '/sprites/walk/humanoid_front.png', up: '/sprites/walk/humanoid_back.png', left: '/sprites/walk/humanoid_left.png', right: '/sprites/walk/humanoid_right.png' },
  monkey:   { down: '/sprites/walk/monkey_front.png',   up: '/sprites/walk/monkey_back.png',   left: '/sprites/walk/monkey_left.png',   right: '/sprites/walk/monkey_right.png' },
  evilbot:  { down: '/sprites/walk/evilbot_front.png',  up: '/sprites/walk/evilbot_back.png',  left: '/sprites/walk/evilbot_left.png',  right: '/sprites/walk/evilbot_right.png' },
  cortex:   { down: '/sprites/walk/cortex_front.png',   up: '/sprites/walk/cortex_back.png',   left: '/sprites/walk/cortex_left.png',   right: '/sprites/walk/cortex_right.png' },
  goblin:   { down: '/sprites/walk/goblin_front.png',   up: '/sprites/walk/goblin_back.png',   left: '/sprites/walk/goblin_left.png',   right: '/sprites/walk/goblin_right.png' },
};

// Paint an N-frame horizontal strip through the same pixelate→tint→re-clip
// pipeline as a single sprite (cells stay square because the pixelation grid is
// AGENT_PX per cell). Used by walk cycles and battle idle/attack clips alike.
function paintStrip(c: HTMLCanvasElement, src: string, frames: number, color: string, strength: number) {
  const render = () => {
    const img = loadImg(src);
    const W = c.width, H = c.height;     // W = H * frames (cells are square)
    const x = c.getContext('2d')!;
    x.clearRect(0, 0, W, H);
    const pw = AGENT_PX * frames;
    const tmp = document.createElement('canvas'); tmp.width = pw; tmp.height = AGENT_PX;
    const tx = tmp.getContext('2d')!;
    tx.imageSmoothingEnabled = true;
    tx.drawImage(img, 0, 0, pw, AGENT_PX);
    x.imageSmoothingEnabled = false;
    x.drawImage(tmp, 0, 0, W, H);
    if (color && strength > 0) {
      x.globalCompositeOperation = 'color';
      x.globalAlpha = strength;
      x.fillStyle = color; x.fillRect(0, 0, W, H);
      x.globalAlpha = 1;
      x.globalCompositeOperation = 'destination-in';
      x.imageSmoothingEnabled = false;
      x.drawImage(tmp, 0, 0, W, H);
      x.globalCompositeOperation = 'source-over';
    }
  };
  onImg(src, render);
}

function stripTexture(src: string, frames: number, color: string, strength: number): THREE.Texture {
  const c = document.createElement('canvas'); c.height = 512; c.width = 512 * frames;
  paintStrip(c, src, frames, color, strength);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.anisotropy = 4;
  onImg(src, () => { t.needsUpdate = true; });
  return t;
}

export function humanoidWalkTexture(color: string, dir: WalkDir, strength = 0.45, body: AgentBody = 'humanoid'): THREE.Texture {
  return stripTexture(WALK_SRC[body][dir], WALK_FRAMES, color, strength);
}

// --- battle clips (puppet-animated, baked by tools/bake_battle.py) ---
// idle = breathing + pulsing weapon glow (loops); atk = a firing muzzle burst
// (played once on attack/buster). Same recolor pipeline tints the flash to the
// shell's energy colour.
export const BATTLE_IDLE_FRAMES = 6;
export const BATTLE_ATK_FRAMES = 5;
export const BATTLE_MELEE_FRAMES = 5;
const BATTLE_IDLE_SRC: Record<AgentBody, string> = {
  humanoid: '/sprites/battle/humanoid_idle.png', monkey: '/sprites/battle/monkey_idle.png',
  evilbot: '/sprites/battle/evilbot_idle.png', cortex: '/sprites/battle/cortex_idle.png',
  goblin: '/sprites/battle/goblin_idle.png',
};
const BATTLE_ATK_SRC: Record<AgentBody, string> = {
  humanoid: '/sprites/battle/humanoid_atk.png', monkey: '/sprites/battle/monkey_atk.png',
  evilbot: '/sprites/battle/evilbot_atk.png', cortex: '/sprites/battle/cortex_atk.png',
  goblin: '/sprites/battle/goblin_atk.png',
};
const BATTLE_MELEE_SRC: Record<AgentBody, string> = {
  humanoid: '/sprites/battle/humanoid_melee.png', monkey: '/sprites/battle/monkey_melee.png',
  evilbot: '/sprites/battle/evilbot_melee.png', cortex: '/sprites/battle/cortex_melee.png',
  goblin: '/sprites/battle/goblin_melee.png',
};

export function battleIdleTexture(color: string, strength = 0.45, body: AgentBody = 'humanoid'): THREE.Texture {
  return stripTexture(BATTLE_IDLE_SRC[body], BATTLE_IDLE_FRAMES, color, strength);
}

export function battleAttackTexture(color: string, strength = 0.45, body: AgentBody = 'humanoid'): THREE.Texture {
  return stripTexture(BATTLE_ATK_SRC[body], BATTLE_ATK_FRAMES, color, strength);
}

// melee = a forward crescent slash sweep (distinct from the buster muzzle burst)
export function battleMeleeTexture(color: string, strength = 0.45, body: AgentBody = 'humanoid'): THREE.Texture {
  return stripTexture(BATTLE_MELEE_SRC[body], BATTLE_MELEE_FRAMES, color, strength);
}
