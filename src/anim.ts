import * as THREE from 'three';

// Procedural billboard animation for the HD-2D pixel sprites. Keeps the art
// perfectly crisp (no resampling) while giving each character life: an idle
// breath (bob + squash/stretch), an attack lunge that can swap to a dedicated
// attack-pose texture, and a hit flinch with a colour flash. Feet stay planted
// during the squash so nothing floats.

export interface AnimOpts {
  base: THREE.Vector3;       // resting position (tile centre); mutate via setBase
  scaleW: number;
  scaleH: number;
  facing: number;            // +1 lunges toward +x, -1 toward -x
  idleTex: THREE.Texture;
  attackTex?: THREE.Texture; // optional pose swap during an attack
  bob?: number;              // idle bob amplitude
  phase?: number;            // desync two sprites' idles
  hitColor?: number;         // flash tint when struck
  // optional Seedance-baked frame sheet for the idle (horizontal strip)
  sheet?: THREE.Texture;
  frames?: number;
  fps?: number;
  // optional one-shot Seedance strips played once per attack/buster
  attackSheet?: THREE.Texture;
  attackFrames?: number;
  blasterSheet?: THREE.Texture;
  blasterFrames?: number;
  // one-shot hurt (on hit) and victory (on win; holds last frame) strips
  hurtSheet?: THREE.Texture;
  hurtFrames?: number;
  victorySheet?: THREE.Texture;
  victoryFrames?: number;
  // optional 4-direction walk strips (overworld)
  walk?: { down: THREE.Texture; up: THREE.Texture; left: THREE.Texture; right: THREE.Texture };
  walkFrames?: number;
  walkFps?: number;
  // anchor the billboard by its feet (sprite.center.y = 0) so position.y is the
  // ground contact point and scale never shifts where it stands.
  anchorBottom?: boolean;
}

type Dir = 'down' | 'up' | 'left' | 'right';

const ATK = 0.42;     // melee attack length (s)
const BLAST = 0.30;   // buster/blaster length (s)
const HIT = 0.28;     // flinch length (s)
const HURT = 0.5;     // hurt-clip length (s)
const VICTORY = 1.2;  // victory-clip length (s) before it holds on the last frame

type OneShot = 'attack' | 'blaster' | 'hurt' | 'victory';

interface Clip { tex: THREE.Texture; frames: number; }

export class SpriteAnim {
  private t: number;
  private atk = 0;
  private hit = 0;
  private flash = 0;
  private mat: THREE.SpriteMaterial;
  private idleTex: THREE.Texture;
  private attackTex?: THREE.Texture;
  private scaleW: number;
  private scaleH: number;
  private freq = 2.3;
  private tmp = new THREE.Color();
  private hitColor: THREE.Color;
  private sheet?: THREE.Texture;
  private frames = 1;
  private fps = 9;
  private atkKind: OneShot = 'attack';
  private atkDur = ATK;
  private clips: { attack?: Clip; blaster?: Clip; hurt?: Clip; victory?: Clip } = {};
  private heldKind: OneShot | null = null; // a one-shot that holds its last frame (victory)
  private walk?: Record<Dir, THREE.Texture>;
  private walkFrames = 1;
  private walkFps = 10;
  private moveDir: Dir | null = null;
  private running = false;
  private walkT = 0;            // walk-cycle phase (advances only while moving)

  constructor(private sprite: THREE.Sprite, private o: AnimOpts) {
    this.mat = sprite.material as THREE.SpriteMaterial;
    this.idleTex = o.idleTex;
    this.attackTex = o.attackTex;
    this.scaleW = o.scaleW;
    this.scaleH = o.scaleH;
    this.t = o.phase ?? 0;
    this.hitColor = new THREE.Color(o.hitColor ?? 0xffffff);
    if (o.anchorBottom) sprite.center.set(0.5, 0); // position.y becomes the feet
    if (o.sheet && o.frames) {
      this.sheet = o.sheet;
      this.frames = o.frames;
      this.fps = o.fps ?? 9;
      this.sheet.repeat.set(1 / this.frames, 1); // show one cell of the strip
    }
    if (o.attackSheet && o.attackFrames) {
      o.attackSheet.repeat.set(1 / o.attackFrames, 1);
      this.clips.attack = { tex: o.attackSheet, frames: o.attackFrames };
    }
    if (o.blasterSheet && o.blasterFrames) {
      o.blasterSheet.repeat.set(1 / o.blasterFrames, 1);
      this.clips.blaster = { tex: o.blasterSheet, frames: o.blasterFrames };
    }
    if (o.hurtSheet && o.hurtFrames) {
      o.hurtSheet.repeat.set(1 / o.hurtFrames, 1);
      this.clips.hurt = { tex: o.hurtSheet, frames: o.hurtFrames };
    }
    if (o.victorySheet && o.victoryFrames) {
      o.victorySheet.repeat.set(1 / o.victoryFrames, 1);
      this.clips.victory = { tex: o.victorySheet, frames: o.victoryFrames };
    }
    if (o.walk && o.walkFrames) {
      this.walk = o.walk;
      this.walkFrames = o.walkFrames;
      this.walkFps = o.walkFps ?? 10;
      for (const k of ['down', 'up', 'left', 'right'] as Dir[]) this.walk[k].repeat.set(1 / this.walkFrames, 1);
    }
  }

  // Overworld: which way we're walking (null = standing still), and whether
  // we're running (Shift) — the procedural walk cycle picks up the cadence.
  setMove(dir: Dir | null, running = false) { this.moveDir = dir; this.running = running; }

  setBase(x: number, y: number, z: number) { this.o.base.set(x, y, z); }

  setLook(idle: THREE.Texture, attack: THREE.Texture | undefined, scaleW: number, scaleH: number) {
    this.idleTex = idle;
    this.attackTex = attack;
    this.scaleW = scaleW;
    this.scaleH = scaleH;
  }

  // Swap the Seedance-baked idle/attack strips at runtime (used when the enemy
  // changes between fights). Pass undefined sheets to fall back to the static
  // idleTex/attackTex set via setLook.
  setSheets(o: {
    idleSheet?: THREE.Texture; idleFrames?: number; idleFps?: number;
    attackSheet?: THREE.Texture; attackFrames?: number;
  }) {
    if (o.idleSheet && o.idleFrames) {
      this.sheet = o.idleSheet;
      this.frames = o.idleFrames;
      this.fps = o.idleFps ?? 9;
      this.sheet.repeat.set(1 / this.frames, 1);
      this.sheet.offset.x = 0;
    } else {
      this.sheet = undefined;
      this.frames = 1;
    }
    if (o.attackSheet && o.attackFrames) {
      o.attackSheet.repeat.set(1 / o.attackFrames, 1);
      o.attackSheet.offset.x = 0;
      this.clips.attack = { tex: o.attackSheet, frames: o.attackFrames };
    } else {
      this.clips.attack = undefined;
    }
  }

  // swap the 4-direction walk strips at runtime (overworld character change)
  setWalkSheets(walk: Record<Dir, THREE.Texture>, frames: number, fps: number) {
    this.walk = walk;
    this.walkFrames = frames;
    this.walkFps = fps;
    for (const k of ['down', 'up', 'left', 'right'] as Dir[]) this.walk[k].repeat.set(1 / frames, 1);
  }

  triggerAttack() { this.atk = ATK; this.atkDur = ATK; this.atkKind = 'attack'; }
  triggerBlaster() { this.atk = BLAST; this.atkDur = BLAST; this.atkKind = 'blaster'; }
  triggerHit() {
    this.hit = HIT; this.flash = 0.14;
    if (this.clips.hurt && this.heldKind !== 'victory') { this.atk = HURT; this.atkDur = HURT; this.atkKind = 'hurt'; }
  }
  // play the victory clip once, then hold its final frame until cleared
  triggerVictory() {
    if (!this.clips.victory) return;
    this.atk = VICTORY; this.atkDur = VICTORY; this.atkKind = 'victory'; this.heldKind = 'victory';
  }
  clearOneShot() { this.atk = 0; this.heldKind = null; }

  update(dt: number) {
    this.t += dt;
    this.atk = Math.max(0, this.atk - dt);
    this.hit = Math.max(0, this.hit - dt);
    this.flash = Math.max(0, this.flash - dt);

    const hasWalkSheet = this.moveDir !== null && this.walk !== undefined;
    const procWalk = this.moveDir !== null && this.walk === undefined;

    let xoff = 0, yoff = 0, sx = 1, sy = 1, rot = 0;
    if (procWalk) {
      // procedural walk/run cycle for single-frame billboards: a two-step bounce
      // (|sin| → up at the passing pose, down at each footfall) with a footfall
      // squash/stretch, a gentle side-to-side sway, and a forward lean. Running
      // (Shift) quickens the cadence and exaggerates the bounce, squash, and lean.
      const cadence = this.running ? 13 : 8;
      this.walkT += dt * cadence;
      const step = Math.abs(Math.sin(this.walkT));      // 0 at footfall, 1 at passing
      const amp = this.running ? 0.22 : 0.12;
      yoff += step * amp;                               // bounce up between steps
      sy += (step - 0.5) * (this.running ? 0.12 : 0.07); // squash low, stretch high
      sx -= (step - 0.5) * (this.running ? 0.08 : 0.045);
      xoff += Math.sin(this.walkT * 0.5) * (this.running ? 0.05 : 0.03); // hip sway
      const dirLean = this.moveDir === 'left' ? 1 : this.moveDir === 'right' ? -1 : 0;
      rot = dirLean * (this.running ? 0.13 : 0.06) + Math.sin(this.walkT * 0.5) * 0.03;
    } else if (hasWalkSheet && this.running) {
      // baked frames carry the stride; add only a forward lean when sprinting
      const dirLean = this.moveDir === 'left' ? 1 : this.moveDir === 'right' ? -1 : 0;
      rot = dirLean * 0.1;
    } else if (!this.sheet && !hasWalkSheet) {
      // procedural idle breath (skipped when a baked sheet/walk supplies motion)
      const wave = Math.sin(this.t * this.freq);
      const bob = this.o.bob ?? 0.05;
      yoff = wave * bob;
      sx = 1 + wave * 0.022;
      sy = 1 - wave * 0.03;
    }

    // attack: a forward lunge with anticipation squash then a strike stretch
    // (buster lunges less — it's a ranged shot, not a melee swing). hurt and
    // victory clips carry their own motion, so they don't lunge.
    if (this.atk > 0 && (this.atkKind === 'attack' || this.atkKind === 'blaster')) {
      const p = 1 - this.atk / this.atkDur;         // 0 -> 1
      const swell = Math.sin(p * Math.PI);          // 0 -> 1 -> 0
      const lunge = Math.sin(Math.min(p * 1.4, 1) * Math.PI);
      const reach = this.atkKind === 'blaster' ? 0.32 : 0.7;
      xoff += this.o.facing * reach * lunge;
      yoff += 0.16 * swell;
      sy += 0.12 * swell;
      sx -= 0.08 * swell;
    }

    // hit: recoil backward + squash
    if (this.hit > 0) {
      const p = this.hit / HIT;                      // 1 -> 0
      xoff -= this.o.facing * 0.3 * p;
      sx += 0.1 * p;
      sy -= 0.1 * p;
    }

    // keep the feet planted while the body squashes/stretches
    // (only for centre-anchored sprites; bottom-anchored ones plant naturally)
    if (!this.o.anchorBottom) yoff += this.scaleH * (sy - 1) / 2;

    // choose the texture. priority: active one-shot clip (attack/blaster/hurt/
    // victory) > a held clip's final frame (victory) > attack pose > directional
    // walk > baked idle sheet > static idle.
    const clip = this.atk > 0 ? this.clips[this.atkKind]
               : this.heldKind ? this.clips[this.heldKind] : undefined;
    let want: THREE.Texture;
    if (clip) want = clip.tex;
    else if (this.atk > 0 && this.attackTex) want = this.attackTex;
    else if (hasWalkSheet) want = this.walk![this.moveDir!];
    else if (this.sheet) want = this.sheet;
    else want = this.idleTex;
    if (this.mat.map !== want) { this.mat.map = want; this.mat.needsUpdate = true; }
    if (clip && want === clip.tex) {
      const p = this.atk > 0 ? 1 - this.atk / this.atkDur : 1; // play forward, then hold last frame
      const fr = Math.min(clip.frames - 1, Math.floor(p * clip.frames));
      clip.tex.offset.x = fr / clip.frames;
    } else if (hasWalkSheet && want === this.walk![this.moveDir!]) {
      const fps = this.running ? this.walkFps * 1.7 : this.walkFps; // run = quicker cadence
      const fr = Math.floor(this.t * fps) % this.walkFrames; // loop the walk
      want.offset.x = fr / this.walkFrames;
    } else if (want === this.sheet) {
      const fr = Math.floor(this.t * this.fps) % this.frames; // loop the idle
      this.sheet!.offset.x = fr / this.frames;
    }

    this.sprite.position.set(this.o.base.x + xoff, this.o.base.y + yoff, this.o.base.z);
    this.sprite.scale.set(this.scaleW * sx, this.scaleH * sy, 1);
    this.mat.rotation = rot; // walk/run lean & sway (0 otherwise)

    // flash tint on hit
    this.tmp.setScalar(1);
    if (this.flash > 0) this.tmp.lerp(this.hitColor, 0.75);
    this.mat.color.copy(this.tmp);
  }
}
