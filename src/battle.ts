import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  textures, orbTexture, humanoidTexture,
  battleIdleTexture, battleAttackTexture, battleMeleeTexture,
  BATTLE_IDLE_FRAMES, BATTLE_ATK_FRAMES, BATTLE_MELEE_FRAMES,
} from './sprites.ts';
import { getSelectedCharacter, addCredits, tintColor, getSelectedBody } from './characters.ts';
import { addWin } from './progress.ts';
import { PanelGrid } from './panels.ts';
import { SpriteAnim } from './anim.ts';
import type { NetClient } from './net.ts';
import type { AgentBody } from './sprites.ts';
import {
  buildStarterFolder, shuffle, comboMatch,
  type Chip,
} from './chips.ts';
import type { Session } from './wallet.ts';

// ---------- Grid constants ----------
const COLS = 10; // 5 panels per side
const ROWS = 5;
const TILE_W = 1.12;
const TILE_D = 1.12;
const PLAYER_COLS = [0, 1, 2, 3, 4];
const CUSTOM_TIME = 7; // seconds for the custom gauge to fill

const colX = (col: number) => (col - (COLS - 1) / 2) * TILE_W;
const rowZ = (row: number) => (row - (ROWS - 1) / 2) * TILE_D;

const CHARGE_FULL = 1.0;       // hold time for a full charged shot (s)
const CHARGE_TELEGRAPH = 0.4;  // when the enemy can "read" the charge and react
const CHARGED_DMG = 50;

type Pattern = 'shot' | 'dash' | 'smash' | 'spin' | 'bombrun' | 'pincer';
interface EnemyDef {
  name: string; tex: () => THREE.Texture; hp: number; scale: number;
  pattern: Pattern; yoff?: number; atk?: () => THREE.Texture;
  // optional status ability the foe sometimes casts instead of its pattern:
  // 'snare' = freeze you in place, 'hex' = mark you to take +50% damage.
  status?: 'snare' | 'hex';
  // chance (0..1) a hardened foe shrugs off your control ops (freeze/mark/slow).
  resist?: number;
  // optional Seedance-baked animation strips (square cells); fall back to the
  // static tex/atk + procedural idle bob when absent.
  idleSheet?: () => THREE.Texture; idleFrames?: number; idleFps?: number;
  attackSheet?: () => THREE.Texture; attackFrames?: number;
}

// The opponent gauntlet — beat one, the rematch button feeds you the next.
// yoff seats sprites whose art isn't centered on its feet (wide/flying ones).
const ENEMY_ROSTER: EnemyDef[] = [
  { name: 'TRALALERO', tex: textures.tralalero, atk: textures.tralaleroAtk, hp: 240, scale: 2.7, pattern: 'dash',
    idleSheet: textures.tralaleroIdleSheet, idleFrames: 8, idleFps: 9, attackSheet: textures.tralaleroAtkSheet, attackFrames: 6 },
  { name: 'TUNG TUNG', tex: textures.tungtung, atk: textures.tungtungAtk, hp: 300, scale: 2.5, pattern: 'smash',
    idleSheet: textures.tungtungIdleSheet, idleFrames: 8, idleFps: 9, attackSheet: textures.tungtungAtkSheet, attackFrames: 6 },
  { name: 'ANGLER', tex: textures.angler, atk: textures.anglerAtk, hp: 320, scale: 2.5, yoff: 0.25, pattern: 'shot',
    idleSheet: textures.anglerIdleSheet, idleFrames: 8, idleFps: 9, attackSheet: textures.anglerAtkSheet, attackFrames: 6 },
  { name: 'BALLERINA', tex: textures.ballerina, atk: textures.ballerinaAtk, hp: 260, scale: 2.4, pattern: 'spin',
    idleSheet: textures.ballerinaIdleSheet, idleFrames: 8, idleFps: 9, attackSheet: textures.ballerinaAtkSheet, attackFrames: 6 },
  { name: 'BOMBARDIRO', tex: textures.bombardiro, atk: textures.bombardiroAtk, hp: 360, scale: 2.7, yoff: 0.7, pattern: 'bombrun', resist: 0.3,
    idleSheet: textures.bombardiroIdleSheet, idleFrames: 8, idleFps: 9, attackSheet: textures.bombardiroAtkSheet, attackFrames: 6 },
  { name: 'CORAL CRAB', tex: textures.crab, atk: textures.crabAtk, hp: 460, scale: 3.0, pattern: 'pincer', resist: 0.4,
    idleSheet: textures.crabIdleSheet, idleFrames: 8, idleFps: 9, attackSheet: textures.crabAtkSheet, attackFrames: 6 },
  // rogue-AI processes
  { name: 'HALLUCINATION', tex: textures.hallucination, atk: textures.hallucinationAtk, hp: 280, scale: 2.6, yoff: 0.15, pattern: 'spin', status: 'hex',
    idleSheet: textures.hallucinationIdleSheet, idleFrames: 8, idleFps: 9, attackSheet: textures.hallucinationAtkSheet, attackFrames: 6 },
  { name: 'DAEMON', tex: textures.daemon, atk: textures.daemonAtk, hp: 360, scale: 2.6, pattern: 'pincer', status: 'snare', resist: 0.35,
    idleSheet: textures.daemonIdleSheet, idleFrames: 8, idleFps: 9, attackSheet: textures.daemonAtkSheet, attackFrames: 6 },
  { name: 'RUNAWAY.EXE', tex: textures.trainer, atk: textures.trainerAtk, hp: 520, scale: 3.0, pattern: 'bombrun', status: 'snare', resist: 0.5,
    idleSheet: textures.trainerIdleSheet, idleFrames: 8, idleFps: 9, attackSheet: textures.trainerAtkSheet, attackFrames: 6 },
  { name: 'WEB CRAWLER', tex: textures.crawler, atk: textures.crawlerAtk, hp: 300, scale: 2.7, pattern: 'dash',
    idleSheet: textures.crawlerIdleSheet, idleFrames: 8, idleFps: 9, attackSheet: textures.crawlerAtkSheet, attackFrames: 6 },
];

export const ENEMY_COUNT = ENEMY_ROSTER.length;

interface Projectile {
  sprite: THREE.Sprite;
  row: number;
  dir: 1 | -1;
  speed: number;
  damage: number;
  owner: 'player' | 'enemy';
  alive: boolean;
  breach?: boolean; // ignores the target's guard barrier
  heal?: number;    // heals the owner on hit (Drain)
  knock?: number;   // shoves the enemy back this many columns on hit (Water)
  freeze?: number;  // freezes the player on hit for this many seconds (enemy Snare)
  mark?: number;    // marks the player on hit for this many seconds (enemy Hex)
}

interface Effect { sprite: THREE.Sprite; life: number; ttl: number; grow: number; }

export interface PvpOpts {
  role: 'host' | 'guest';
  net: NetClient;
  oppId: number; oppName: string; oppBody: string; oppTint: string;
}

export interface BattleOpts {
  startIndex?: number;     // which roster entry to open on
  encounter?: boolean;     // true = single fight that returns to the overworld
  onExit?: () => void;     // called when the player leaves an encounter battle
  pvp?: PvpOpts;           // PvP duel: opponent driven by the network, not AI
}

export class BattleScene {
  private renderer: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;

  // entities
  private player!: THREE.Sprite;
  private enemy!: THREE.Sprite;
  private playerAnim!: SpriteAnim;
  private enemyAnim!: SpriteAnim;
  private playerShadow!: THREE.Mesh;
  private enemyShadow!: THREE.Mesh;
  private playerPos = { col: 2, row: 2 };
  private enemyPos = { col: 7, row: 2 };
  private playerHP = 200; private playerHPMax = 200;
  private enemyHP = 320; private enemyHPMax = 320;
  private enemyIndex = 0;
  private enemyBaseY = 0.18; // feet-on-panel (enemy billboard is bottom-anchored)
  private enemyDef: EnemyDef = ENEMY_ROSTER[0];

  // grid + telegraphed tile strikes
  private grid!: PanelGrid;
  private strikes: Array<{ col: number; row: number; t: number; damage: number; crack: boolean; marker: THREE.Mesh }> = [];
  // game-theory state: Aegis barrier + buried DataMines
  private guardT = 0;            // seconds of player barrier left
  private guardCounter = 0;      // damage reflected on a successful block
  private guardSprite?: THREE.Sprite;
  private mines: Array<{ col: number; row: number; dmg: number; marker: THREE.Mesh }> = [];
  // burning tiles (Thermal Run / volcano): scorch whoever stands on them per tick
  private fires: Array<{ col: number; row: number; t: number; tick: number; dmg: number; marker: THREE.Mesh }> = [];
  // enemy side of the triangle: the foe can Guard (block + counter) and Breach
  private enemyGuardT = 0;
  private enemyGuardCounter = 0;
  private enemyGuardSprite?: THREE.Sprite;
  // status effects driving the setup/synergy chips
  private enemyFreezeT = 0;     // Deadlock: enemy can't move or act
  private enemySlowT = 0;       // Throttle Core: enemy acts at half speed
  private enemyMarkT = 0;       // Exploit Tag: enemy takes +50% from your hits
  private playerAura = 0;       // Sentinel: incoming damage soaked before HP
  private playerAuraT = 0;      // Sentinel: seconds of aura left
  private auraSprite?: THREE.Sprite;
  private nextChipAmp = 0;      // Overdrive: bonus multiplier on the next op
  // enemy-inflicted debuffs on the player
  private playerFreezeT = 0;    // Snare: can't move (can't dodge), can still act
  private playerMarkT = 0;      // Hex: player takes +50% damage
  private playerResistT = 0;    // Rollback: immune to new freeze/mark while ticking
  private frostMat!: THREE.SpriteMaterial;
  private playerFrost?: THREE.Sprite;
  private enemyFrost?: THREE.Sprite;
  // player buster charge + feint (bluff): hold to charge a big Strike, cancel
  // with a chip (right-click) to bait a guard then Breach through it.
  private charging = false;
  private chargeT = 0;
  private chargeConsumed = false;
  private chargeSprite?: THREE.Sprite;

  // combat state
  private projectiles: Projectile[] = [];
  private effects: Effect[] = [];
  private custom = CUSTOM_TIME;       // starts full so you can pick opening chips
  private queue: Chip[] = [];
  private drawPile: Chip[];
  private paused = false;
  private over = false;

  // input
  private keys: Record<string, boolean> = {};
  private fresh: string[] = [];
  private moveCd = 0;
  private mouseLeft = false;
  private enemyMoveCd = 1.5;
  private enemyFireCd = 2.0;

  // DOM
  private hud!: HTMLElement;
  private customWindow!: HTMLElement;
  private result!: HTMLElement;
  private busterMat: THREE.SpriteMaterial;
  private cannonMat: THREE.SpriteMaterial;
  private enemyShotMat: THREE.SpriteMaterial;
  private slashMat: THREE.SpriteMaterial;
  private boomMat: THREE.SpriteMaterial;
  private waterMat: THREE.SpriteMaterial;
  private guardMat!: THREE.SpriteMaterial;

  private encounter: boolean;
  private onExit?: () => void;
  private walletTag!: HTMLElement;

  // PvP: opponent is the remote player (no AI). Each client simulates itself and
  // mirrors the foe; coordinates flip across the centre (col -> COLS-1-col).
  private pvp?: PvpOpts;
  private net?: NetClient;
  private oppId = 0;
  private netT = 0;

  constructor(private container: HTMLElement, session: Session, opts: BattleOpts = {}) {
    this.enemyIndex = (opts.startIndex ?? 0) % ENEMY_ROSTER.length;
    this.enemyDef = ENEMY_ROSTER[this.enemyIndex];
    this.encounter = opts.encounter ?? false;
    this.onExit = opts.onExit;
    this.pvp = opts.pvp;
    this.net = opts.pvp?.net;
    this.oppId = opts.pvp?.oppId ?? 0;
    this.drawPile = shuffle(buildStarterFolder());

    // ---- renderer ----
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    // ---- camera (tilted-down HD-2D framing) ----
    this.camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 7.8, 10.4);
    this.camera.lookAt(0, 0.7, 0.2);

    this.busterMat = new THREE.SpriteMaterial({ map: orbTexture('#eaffff', '#4fe3d0'), transparent: true, depthWrite: false });
    this.cannonMat = new THREE.SpriteMaterial({ map: orbTexture('#fff4d6', '#ffb347'), transparent: true, depthWrite: false });
    this.enemyShotMat = new THREE.SpriteMaterial({ map: orbTexture('#ffd9e6', '#ff4d6d'), transparent: true, depthWrite: false });
    this.slashMat = new THREE.SpriteMaterial({ map: orbTexture('#ffffff', '#9be7ff'), transparent: true, depthWrite: false });
    this.boomMat = new THREE.SpriteMaterial({ map: orbTexture('#fff0c0', '#ff7a3c'), transparent: true, depthWrite: false });
    this.waterMat = new THREE.SpriteMaterial({ map: orbTexture('#e6f9ff', '#2f9be8'), transparent: true, depthWrite: false });
    this.frostMat = new THREE.SpriteMaterial({ map: orbTexture('#dffaff', '#69d6ff'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 });
    this.guardMat = new THREE.SpriteMaterial({ map: orbTexture('#e6fbff', '#35e8ff'), transparent: true, depthWrite: false, opacity: 0.85 });

    this.buildWorld();
    this.buildHUD(session);

    // ---- HD-2D bloom (only bright neon/emissive parts glow) ----
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.7,  // strength
      0.5,  // radius
      0.8,  // threshold
    );
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.addEventListener('mousedown', this.onMouseDown);
    this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.onBlur);

    // dev hook: lets headless QA poke combat state (e.g. force a freeze) via ?dev
    if (new URLSearchParams(location.search).has('dev')) (window as any).__battle = this;

    if (this.pvp) this.initPvp();

    this.loop();
  }

  // ---------------- PvP ----------------
  private mcol(c: number) { return COLS - 1 - c; } // mirror a column across the centre

  private initPvp() {
    const o = this.pvp!;
    // the foe is the opponent's chosen agent, facing left toward you
    this.enemyHP = this.playerHPMax; this.enemyHPMax = this.playerHPMax;
    this.enemyDef = { ...this.enemyDef, name: o.oppName };
    const tex = humanoidTexture(o.oppTint, 'left', 0.45, o.oppBody as AgentBody);
    const mat = this.enemy.material as THREE.SpriteMaterial;
    mat.map = tex; mat.needsUpdate = true;
    // render the opponent agent exactly like the player (same size & centre
    // anchor) — the AI enemy was bottom-anchored at 3.0 which read as a giant.
    this.enemy.center.set(0.5, 0.5);
    this.enemy.scale.set(2.0, 2.0, 1);
    this.enemyBaseY = 1.15;
    this.enemyAnim?.setLook(tex, tex, 2.0, 2.0);
    this.enemyAnim?.setSheets({}); // drop the AI enemy's Seedance strips
    this.syncEntity(this.enemy, this.enemyPos);
    const nm = this.hud?.querySelector('#hp-enemy .ename') as HTMLElement | null;
    if (nm) nm.textContent = o.oppName;
    this.updateHUD();

    // network: opponent state + combat events
    const net = this.net!;
    net.clearHandlers();
    net.on('bnet', (m) => this.onBnet(m));
    net.on('down', () => { if (!this.over) this.endBattle(true); }); // opponent dropped
  }

  private bsend(sub: string, extra: Record<string, unknown> = {}) {
    this.net?.send({ type: 'bnet', to: this.oppId, sub, ...extra });
  }

  // stream my state to the opponent (they render me as their foe, mirrored)
  private netSync(dt: number) {
    this.netT += dt;
    if (this.netT < 0.06) return; // ~16 Hz
    this.netT = 0;
    this.bsend('pstate', {
      col: this.playerPos.col, row: this.playerPos.row,
      hp: this.playerHP, hpMax: this.playerHPMax,
    });
  }

  private matFor(kind: string): THREE.SpriteMaterial {
    switch (kind) {
      case 'cannon': return this.cannonMat;
      case 'boom': return this.boomMat;
      case 'slash': return this.slashMat;
      case 'water': return this.waterMat;
      case 'guard': return this.guardMat;
      default: return this.busterMat;
    }
  }

  private onBnet(m: Record<string, unknown>) {
    if (this.over) return;
    const sub = m.sub as string;
    if (sub === 'pstate') {
      this.enemyPos = { col: this.mcol(m.col as number), row: m.row as number };
      this.syncEntity(this.enemy, this.enemyPos);
      this.enemyHP = m.hp as number; this.enemyHPMax = m.hpMax as number;
      this.updateHUD();
      if (this.enemyHP <= 0) this.endBattle(true);
    } else if (sub === 'shot') {
      // a projectile the foe fired — render it flying toward me (visual only;
      // the damage arrives as a 'hit'). spawnProjectile('enemy') already aims -x.
      this.spawnProjectile('enemy', m.row as number, m.speed as number, 0, this.matFor(m.kind as string), m.size as number);
    } else if (sub === 'fx') {
      this.spawnEffect(new THREE.Vector3(colX(this.mcol(m.col as number)), 1.15, rowZ(m.row as number)), this.matFor(m.kind as string), (m.size as number) || 1.0);
    } else if (sub === 'hit') {
      this.damagePlayer(m.damage as number);
      if (this.playerResistT <= 0) {
        if (m.freeze) this.playerFreezeT = m.freeze as number;
        if (m.mark) this.playerMarkT = m.mark as number;
      }
    } else if (sub === 'status') {
      if (m.knock) { for (let i = 0; i < (m.knock as number); i++) this.shoveSelfBack(); }
    } else if (sub === 'over') {
      this.endBattle(true);
    }
  }

  // shove my own fighter toward my back wall (col 0) — used by the foe's knockback
  private shoveSelfBack() {
    const c = this.playerPos.col - 1;
    if (c >= 0 && this.grid.canStand(c, this.playerPos.row, 'player')) {
      this.playerPos = { col: c, row: this.playerPos.row };
      this.syncEntity(this.player, this.playerPos);
    }
  }

  // ---------------- World ----------------
  private buildWorld() {
    this.scene.fog = new THREE.Fog(0x051420, 12, 34);

    // backdrop gradient + god rays
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 34),
      new THREE.MeshBasicMaterial({ map: this.gradientTexture(), depthWrite: false }),
    );
    bg.position.set(0, 4, -12);
    this.scene.add(bg);

    // sandy floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: 0x123642, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.13;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // panels — owns shaded tiles + the cracked/broken/ownership lifecycle
    this.grid = new PanelGrid(this.scene, COLS, ROWS, colX, rowZ, TILE_W, TILE_D, PLAYER_COLS);

    // lights
    this.scene.add(new THREE.AmbientLight(0x3a6f7a, 1.1));
    const key = new THREE.DirectionalLight(0xbfeaff, 1.4);
    key.position.set(-4, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const rim = new THREE.PointLight(0x4fe3d0, 30, 30);
    rim.position.set(0, 4, 4);
    this.scene.add(rim);

    // soft contact shadows that sit on whatever panel each fighter occupies
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this.shadowTexture(), transparent: true, opacity: 0.72,
      depthWrite: false, blending: THREE.NormalBlending,
    });
    this.playerShadow = new THREE.Mesh(new THREE.PlaneGeometry(TILE_W * 0.92, TILE_D * 0.66), shadowMat);
    this.enemyShadow = new THREE.Mesh(new THREE.PlaneGeometry(TILE_W * 0.92, TILE_D * 0.66), shadowMat);
    for (const sh of [this.playerShadow, this.enemyShadow]) {
      sh.rotation.x = -Math.PI / 2;     // lie flat on the panel surface
      sh.renderOrder = 1;               // draw over the tile, under the sprite
      this.scene.add(sh);
    }

    // entities (art has transparent padding, so scale up to fill the tile)
    // player = the selected procedural agent shell (idle + arm-cannon attack pose);
    // the engine's procedural bob/lunge/flinch gives it life without frame sheets.
    // player = the selected humanoid agent in its BATTLE stance (arm-cannon ready),
    // tinted per shell; static art with the engine's procedural bob/lunge/flinch.
    const ch = getSelectedCharacter();
    const body = getSelectedBody();
    const tint = tintColor(ch);
    const hero = humanoidTexture(tint, 'battle', 0.45, body);
    this.player = this.makeSprite(hero, 2.0, 2.0);
    this.enemy = this.makeSprite(textures.angler(), 2.4, 2.4);
    this.scene.add(this.player, this.enemy);

    // baked battle clips: a breathing idle (with a pulsing weapon glow) that
    // loops, and a firing muzzle-burst played once on buster/melee.
    this.playerAnim = new SpriteAnim(this.player, {
      base: new THREE.Vector3(), scaleW: 2.0, scaleH: 2.0, facing: 1,
      idleTex: hero, attackTex: hero,
      sheet: battleIdleTexture(tint, 0.45, body), frames: BATTLE_IDLE_FRAMES, fps: 7,
      attackSheet: battleMeleeTexture(tint, 0.45, body), attackFrames: BATTLE_MELEE_FRAMES,
      blasterSheet: battleAttackTexture(tint, 0.45, body), blasterFrames: BATTLE_ATK_FRAMES,
      bob: 0.05, phase: 0, hitColor: 0xff5555,
    });
    this.enemyAnim = new SpriteAnim(this.enemy, {
      base: new THREE.Vector3(), scaleW: 2.4, scaleH: 2.4, facing: -1,
      idleTex: textures.angler(), bob: 0.06, phase: 1.5, hitColor: 0xffffff,
      anchorBottom: true, // seat by the feet so it never sits on the panel line
    });

    this.syncEntity(this.player, this.playerPos);
    this.syncEntity(this.enemy, this.enemyPos);
  }

  private makeSprite(map: THREE.Texture, w: number, h: number): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({ map, transparent: true });
    const s = new THREE.Sprite(mat);
    s.scale.set(w, h, 1);
    return s;
  }

  private syncEntity(s: THREE.Sprite, pos: { col: number; row: number }) {
    const baseY = s === this.enemy ? this.enemyBaseY : 1.15;
    const x = colX(pos.col), z = rowZ(pos.row);
    if (s === this.player && this.playerAnim) this.playerAnim.setBase(x, baseY, z);
    else if (s === this.enemy && this.enemyAnim) this.enemyAnim.setBase(x, baseY, z);
    else s.position.set(x, baseY, z);
    // park the contact shadow on the panel under whoever just moved
    const sh = s === this.player ? this.playerShadow : s === this.enemy ? this.enemyShadow : null;
    if (sh) sh.position.set(x, 0.16, z + 0.12); // just above the panel top (0.142), nudged toward the feet
  }

  // Soft elliptical blob for the contact shadow under each fighter.
  private shadowTexture(): THREE.Texture {
    const S = 128;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.95)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.7)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private gradientTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#0e4258');
    g.addColorStop(0.45, '#0a2a3c');
    g.addColorStop(1, '#04101a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
    // faint god rays
    ctx.globalAlpha = 0.08; ctx.fillStyle = '#bfeaff';
    for (let i = 0; i < 4; i++) ctx.fillRect(2 + i * 4, 0, 1, 140);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ---------------- HUD ----------------
  private buildHUD(session: Session) {
    const tag = document.createElement('div');
    tag.id = 'wallet-tag';
    tag.textContent = `◎ ${session.short} — signed in`;
    this.container.appendChild(tag);
    this.walletTag = tag;

    this.hud = document.createElement('div');
    this.hud.id = 'hud';
    this.hud.innerHTML = `
      <div class="hpbar" id="hp-player"><div class="fill"></div><div class="label"><span>YOU</span><span class="num"></span></div></div>
      <div class="hpbar" id="hp-enemy"><div class="fill"></div><div class="label"><span class="num"></span><span class="ename">ANGLER</span></div></div>
      <div class="statusrow" id="status-player"></div>
      <div class="statusrow" id="status-enemy"></div>
      <div id="custom-gauge"><div class="fill"></div></div>
      <div id="queue"></div>
      <div id="controls">
        <div><kbd>WASD</kbd>/<kbd>↑↓←→</kbd> move</div>
        <div><kbd>L-click</kbd> tap=buster · hold=charge &nbsp; <kbd>R-click</kbd> chip (feints charge)</div>
        <div><kbd>Tab</kbd> allocate compute &nbsp; <kbd>1-6</kbd> pick</div>
      </div>`;
    this.container.appendChild(this.hud);

    this.customWindow = document.createElement('div');
    this.customWindow.id = 'custom-window';
    this.container.appendChild(this.customWindow);

    this.result = document.createElement('div');
    this.result.id = 'result';
    this.container.appendChild(this.result);

    this.applyEnemy(ENEMY_ROSTER[this.enemyIndex]);
    this.updateHUD();
  }

  private applyEnemy(def: EnemyDef) {
    this.enemyDef = def;
    this.enemyHP = def.hp;
    this.enemyHPMax = def.hp;
    this.enemyBaseY = 0.18 + (def.yoff ?? 0);
    this.enemyMoveCd = 1.2;
    this.enemyFireCd = 1.6;
    const mat = this.enemy.material as THREE.SpriteMaterial;
    mat.map = def.tex();
    mat.needsUpdate = true;
    this.enemy.scale.set(def.scale, def.scale, 1);
    this.enemyAnim?.setLook(def.tex(), def.atk?.(), def.scale, def.scale);
    this.enemyAnim?.setSheets({
      idleSheet: def.idleSheet?.(), idleFrames: def.idleFrames, idleFps: def.idleFps,
      attackSheet: def.attackSheet?.(), attackFrames: def.attackFrames,
    });
    this.syncEntity(this.enemy, this.enemyPos);
    const el = this.hud?.querySelector('#hp-enemy .ename') as HTMLElement | null;
    if (el) el.textContent = def.name;
    this.updateHUD();
  }

  private updateHUD() {
    const pPct = Math.max(0, this.playerHP / this.playerHPMax) * 100;
    const ePct = Math.max(0, this.enemyHP / this.enemyHPMax) * 100;
    const pe = this.hud.querySelector('#hp-player') as HTMLElement;
    const ee = this.hud.querySelector('#hp-enemy') as HTMLElement;
    (pe.querySelector('.fill') as HTMLElement).style.width = pPct + '%';
    (ee.querySelector('.fill') as HTMLElement).style.width = ePct + '%';
    (pe.querySelector('.num') as HTMLElement).textContent = String(Math.max(0, Math.ceil(this.playerHP)));
    (ee.querySelector('.num') as HTMLElement).textContent = String(Math.max(0, Math.ceil(this.enemyHP)));

    const gauge = this.hud.querySelector('#custom-gauge') as HTMLElement;
    const ready = this.custom >= CUSTOM_TIME;
    (gauge.querySelector('.fill') as HTMLElement).style.width = Math.min(1, this.custom / CUSTOM_TIME) * 100 + '%';
    gauge.classList.toggle('ready', ready);

    const q = this.hud.querySelector('#queue') as HTMLElement;
    q.innerHTML = this.queue
      .map((c) => `<div class="qchip"><div>${c.icon}</div><div>${c.name}</div><div class="dmg">${c.kind === 'recover' ? '+' : ''}${c.damage}</div><div>${c.code}</div></div>`)
      .join('');
  }

  // ---------------- Custom window ----------------
  private openCustom() {
    if (this.custom < CUSTOM_TIME || this.over) return;
    this.paused = true;
    // RAM budget: spend it to queue ANY mix of chips (no more name/code gate).
    // Each enemy-side column you hold grants +1 RAM (cap +3) — territory → tempo.
    const dc = this.territoryBonus();   // captured data centers → bonus RAM
    const ram = 6 + dc;
    const hand = this.drawPile.slice(0, 6);
    const selected: Chip[] = [];

    // a chip's cost, discounted by 1 (min 1) if it combos (same NAME/CODE) with
    // another selected chip — the classic MMBN combo, now a saving not a gate.
    const cost = (chip: Chip, others: Chip[]) => Math.max(1, chip.cost - (comboMatch(others, chip) ? 1 : 0));
    const spent = () => selected.reduce((s, c) => s + cost(c, selected), 0);
    const affordable = (chip: Chip) => ram - spent() >= cost(chip, selected);

    const render = () => {
      const left = ram - spent();
      this.customWindow.innerHTML = `
        <div class="cw-panel">
          <h2>ALLOCATE COMPUTE</h2>
          <div class="sub">Spend <b style="color:var(--gold)">RAM</b> on any ops · matching NAME/CODE = −1 combo</div>
          <div class="cw-ram">RAM <span style="color:var(--teal)">${left}</span> / ${ram}${dc ? ` &nbsp;·&nbsp; <span style="color:#9be7ff">🗄️ ${dc} data center${dc > 1 ? 's' : ''} → +${dc} RAM</span>` : ''}</div>
          <div class="cw-hand"></div>
          <div class="cw-actions">
            <button class="btn" data-act="confirm">Add to queue ⏎/Tab</button>
            <button class="btn" data-act="cancel">Cancel Esc</button>
          </div>
          <div class="cw-rule">Selected: ${selected.length ? selected.map((c) => c.name).join(', ') : '—'}</div>
        </div>`;
      const handEl = this.customWindow.querySelector('.cw-hand') as HTMLElement;
      hand.forEach((chip, i) => {
        const picked = selected.includes(chip);
        const c = cost(chip, selected.filter((x) => x !== chip));
        const discounted = c < chip.cost;
        const allowed = picked || affordable(chip);
        const card = document.createElement('div');
        card.className = 'chipcard' + (picked ? ' selected' : '') + (allowed ? '' : ' disabled');
        card.innerHTML = `
          <div class="cardnum">${i + 1}</div>
          <div class="cost${discounted ? ' disc' : ''}">${c}⚡</div>
          <div class="icon">${chip.icon}</div>
          <div class="name">${chip.name}</div>
          <div class="dmg">${chip.kind === 'recover' || chip.kind === 'megaheal' ? '+' : ''}${chip.damage || ''}</div>
          <div class="code">${chip.code === '*' ? '✷' : chip.code}</div>`;
        card.onclick = () => toggle(chip);
        card.dataset.idx = String(i);
        handEl.appendChild(card);
      });
      (this.customWindow.querySelector('[data-act="confirm"]') as HTMLElement).onclick = () => commit(true);
      (this.customWindow.querySelector('[data-act="cancel"]') as HTMLElement).onclick = () => commit(false);
    };

    const toggle = (chip: Chip) => {
      if (selected.includes(chip)) selected.splice(selected.indexOf(chip), 1);
      else if (affordable(chip)) selected.push(chip);
      render();
    };

    const commit = (apply: boolean) => {
      window.removeEventListener('keydown', onKey, true);
      this.customWindow.classList.remove('open');
      this.customWindow.innerHTML = '';
      this.paused = false;
      if (apply && selected.length) {
        this.queue.push(...selected);
        this.drawPile = [...this.drawPile.slice(hand.length), ...hand]; // rotate hand to the back
        this.custom = 0;
      }
      this.updateHUD();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Tab') { e.preventDefault(); commit(true); }
      else if (e.code === 'Escape') { e.preventDefault(); commit(false); }
      else if (/^(Digit|Numpad)[1-9]$/.test(e.code)) {
        e.preventDefault();
        const chip = hand[parseInt(e.code.replace(/\D/g, ''), 10) - 1];
        if (chip) toggle(chip);
      }
    };
    window.addEventListener('keydown', onKey, true);

    this.customWindow.classList.add('open');
    render();
  }

  // ---------------- Input ----------------
  private gameKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab',
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyJ', 'KeyK']);

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.gameKeys.has(e.code)) e.preventDefault();
    if (this.keys[e.code]) return;
    this.keys[e.code] = true;
    this.fresh.push(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys[e.code] = false; };

  // Mouse: left button = buster (held to repeat), right button = fire chip.
  private onMouseDown = (e: MouseEvent) => {
    if (this.paused || this.over) return;
    if (e.button === 0) this.mouseLeft = true;
    else if (e.button === 2) { e.preventDefault(); this.fireChip(); }
  };
  private onMouseUp = (e: MouseEvent) => { if (e.button === 0) this.mouseLeft = false; };
  private onContextMenu = (e: Event) => { e.preventDefault(); };
  private onBlur = () => { this.mouseLeft = false; };

  private handleInput(dt: number) {
    if (this.paused || this.over) { this.fresh = []; return; }
    const fresh = this.fresh; this.fresh = [];

    // discrete actions
    for (const code of fresh) {
      if (code === 'Space' || code === 'Tab') this.openCustom();
      else if (code === 'KeyK') this.fireChip();
    }

    // movement (held with cooldown) — Snare locks you in place: no dodging
    this.moveCd -= dt;
    if (this.moveCd <= 0 && this.playerFreezeT <= 0) {
      let dc = 0, dr = 0;
      if (this.keys['ArrowLeft'] || this.keys['KeyA']) dc = -1;
      else if (this.keys['ArrowRight'] || this.keys['KeyD']) dc = 1;
      else if (this.keys['ArrowUp'] || this.keys['KeyW']) dr = -1;
      else if (this.keys['ArrowDown'] || this.keys['KeyS']) dr = 1;
      if (dc || dr) { this.tryMove(dc, dr); this.moveCd = 0.14; }
    }

    // buster: tap = quick shot, hold = charge a big Strike, release to fire.
    // Holding telegraphs (glow) so the enemy can react — bluff by cancelling
    // the charge with a chip (see fireChip) to bait a guard, then Breach it.
    const firing = this.keys['KeyJ'] || this.mouseLeft;
    if (firing) {
      this.charging = true;
      if (!this.chargeConsumed) this.chargeT += dt;
    } else if (this.charging) {
      if (!this.chargeConsumed) {
        if (this.chargeT >= CHARGE_FULL) this.fireCharged();
        else this.fireBuster();
      }
      this.charging = false;
      this.chargeT = 0;
      this.chargeConsumed = false;
    }
  }

  private tryMove(dc: number, dr: number) {
    const col = this.playerPos.col + dc;
    const row = this.playerPos.row + dr;
    if (row < 0 || row >= ROWS) return;
    if (!this.grid.canStand(col, row, 'player')) return;
    const prev = { ...this.playerPos };
    this.playerPos.col = col; this.playerPos.row = row;
    this.syncEntity(this.player, this.playerPos);
    this.grid.leave(prev.col, prev.row); // cracked panels collapse behind you
  }

  // ---------------- Attacks ----------------
  private fireBuster() {
    this.playerAnim.triggerBlaster();
    this.spawnProjectile('player', this.playerPos.row, 14, 6, this.busterMat, 0.45);
  }

  private fireCharged() {
    this.playerAnim.triggerBlaster();
    this.spawnProjectile('player', this.playerPos.row, 22, CHARGED_DMG, this.cannonMat, 1.0);
    this.spawnEffect(this.player.position.clone(), this.guardMat, 1.3);
  }

  private fireChip() {
    if (this.over || this.paused) return;
    let chip = this.queue.shift();
    if (!chip) return;
    // FEINT: firing a chip mid-charge cancels the buster shot (no telegraph
    // payoff) — bait the enemy's guard with a charge, then Breach through it.
    if (this.charging) { this.chargeConsumed = true; this.chargeT = 0; }
    // Overdrive: a pending amp supercharges the next damage-dealing op. Clone the
    // chip so we never mutate the folder copy. Buffs/heals don't consume it.
    if (this.nextChipAmp > 0 && chip.damage > 0
        && chip.kind !== 'amp' && chip.kind !== 'aura'
        && chip.kind !== 'recover' && chip.kind !== 'megaheal') {
      chip = { ...chip, damage: Math.round(chip.damage * (1 + this.nextChipAmp)) };
      this.nextChipAmp = 0;
      this.spawnEffect(this.player.position.clone(), this.cannonMat, 1.3);
    }
    this.playerAnim.triggerAttack();
    const row = this.playerPos.row;
    const fromCol = this.playerPos.col;

    switch (chip.kind) {
      case 'flamecannon':
      case 'cannon':
        this.spawnProjectile('player', row, 18, chip.damage, this.cannonMat, 0.8);
        break;
      case 'sword':
        this.meleeTiles([[fromCol + 1, row]], chip.damage, this.slashMat, 1.0);
        break;
      case 'shotgun':
        this.meleeTiles([[fromCol + 1, row], [fromCol + 2, row]], chip.damage, this.busterMat, 0.7);
        break;
      case 'minibomb':
      case 'bomb': {
        const tc = Math.min(COLS - 1, fromCol + 3);
        this.meleeTiles([[tc, row], [tc, row - 1], [tc, row + 1]], chip.damage, this.boomMat, 1.3, true, true);
        break;
      }
      case 'megaheal':
      case 'recover':
        this.playerHP = Math.min(this.playerHPMax, this.playerHP + chip.damage);
        this.spawnEffect(this.player.position.clone(), this.slashMat, 1.0);
        break;
      case 'grab': {
        const stolen = this.grid.grabForPlayer();
        if (stolen >= 0) {
          for (let r = 0; r < ROWS; r++) this.spawnEffect(new THREE.Vector3(colX(stolen), 1.15, rowZ(r)), this.slashMat, 1.1);
          // if the enemy was stranded on a panel we just took, shove it back
          if (this.grid.owner(this.enemyPos.col, this.enemyPos.row) === 'player') {
            const spot = this.grid.anyStandable('enemy', this.enemyPos.row);
            if (spot) { this.enemyPos = spot; this.syncEntity(this.enemy, this.enemyPos); }
          }
        }
        break;
      }
      case 'guard':
        // GUARD node: raise a barrier that eats the next hit and counters.
        this.guardT = 3.0;
        this.guardCounter = chip.damage;
        this.showGuard();
        break;
      case 'lance':
        // BREACH node: pierce the entire row ahead, all columns at once, through guards.
        this.meleeTiles(
          Array.from({ length: COLS - 1 - fromCol }, (_, i) => [fromCol + 1 + i, row] as [number, number]),
          chip.damage, this.slashMat, 1.0, false, true,
        );
        break;
      case 'mine':
        this.placeMine(Math.min(COLS - 1, fromCol + 3), row, chip.damage);
        break;
      case 'wind': {
        // CONTROL: shove the enemy back a column (toward its own back wall).
        this.damageEnemy(chip.damage);
        const back = this.enemyPos.col + 1;
        if (back <= COLS - 1 && this.grid.canStand(back, this.enemyPos.row, 'enemy')) {
          this.enemyPos = { col: back, row: this.enemyPos.row };
          this.syncEntity(this.enemy, this.enemyPos);
        }
        this.spawnEffect(this.enemy.position.clone(), this.slashMat, 1.2);
        break;
      }
      case 'overclock':
        // TEMPO: refill the Custom gauge right now, but crack the panel you stand on.
        this.custom = CUSTOM_TIME;
        this.grid.crack(fromCol, row);
        this.spawnEffect(this.player.position.clone(), this.guardMat, 1.4);
        break;
      case 'vulcan':
        // rapid burst: three shots that spread out by speed
        for (let k = 0; k < 3; k++) this.spawnProjectile('player', row, 15 + k * 3, chip.damage, this.busterMat, 0.5);
        break;
      case 'cluster':
        // GPU Cluster: parallel beams down three rows at once
        for (const dr of [-1, 0, 1]) {
          const r = row + dr;
          if (r >= 0 && r < ROWS) this.spawnProjectile('player', r, 18, chip.damage, this.cannonMat, 0.7);
        }
        break;
      case 'drain':
        // STRIKE that heals you for half the hit on contact
        this.spawnProjectile('player', row, 16, chip.damage, this.enemyShotMat, 0.8, false, Math.round(chip.damage / 2));
        break;
      case 'blink': {
        // CONTROL: warp to your back line on this row (dodge), else any safe tile
        const spot = this.grid.canStand(0, row, 'player') ? { col: 0, row } : this.grid.anyStandable('player', row);
        if (spot) {
          this.spawnEffect(this.player.position.clone(), this.guardMat, 1.1);
          this.playerPos = { col: spot.col, row: spot.row };
          this.syncEntity(this.player, this.playerPos);
          this.spawnEffect(this.player.position.clone(), this.guardMat, 1.1);
        }
        break;
      }
      case 'quake': {
        // BREACH: crack a 2-wide, 3-tall zone ahead and hit through guards
        const tiles: Array<[number, number]> = [];
        for (let dc = 1; dc <= 2; dc++) for (let dr = -1; dr <= 1; dr++) tiles.push([fromCol + dc, row + dr]);
        this.meleeTiles(tiles, chip.damage, this.boomMat, 1.2, true, true);
        break;
      }
      case 'wsword':
        // wide slash: the node ahead plus the nodes diagonally above/below it
        this.meleeTiles([[fromCol + 1, row], [fromCol + 1, row - 1], [fromCol + 1, row + 1]], chip.damage, this.slashMat, 1.15);
        break;
      case 'gatling':
        // rapid token barrage: a tight stream of small fast shots down the row
        for (let k = 0; k < 6; k++) this.spawnProjectile('player', row, 17 + k * 1.2, chip.damage, this.busterMat, 0.4);
        break;
      case 'water':
        // pressurized blast: damages and shoves the enemy back two columns
        this.spawnProjectile('player', row, 16, chip.damage, this.waterMat, 0.95, false, 0, 2);
        break;
      case 'volcano': {
        // ignite a node ahead — it scorches whoever stands on it each tick
        const fc = Math.min(COLS - 1, fromCol + 3);
        this.placeFire(fc, row, chip.damage);
        this.spawnEffect(new THREE.Vector3(colX(fc), 1.15, rowZ(row)), this.boomMat, 1.4);
        break;
      }
      case 'freeze':
        // CONTROL: deadlock the enemy so slow ops land. Light damage. Hardened
        // foes can shrug off the lock (resist) — the hit still connects.
        if (this.tryControlEnemy('freeze', 1.6)) this.spawnEffect(this.enemy.position.clone(), this.waterMat, 1.6);
        this.damageEnemy(chip.damage);
        break;
      case 'mark':
        // CONTROL: tag the enemy to take +50% from your hits for a window.
        if (this.tryControlEnemy('mark', 4.0)) this.spawnEffect(this.enemy.position.clone(), this.enemyShotMat, 1.4);
        this.damageEnemy(chip.damage);
        break;
      case 'amp':
        // TEMPO: bank a +80% buff onto the next op you fire.
        this.nextChipAmp = 0.8;
        this.spawnEffect(this.player.position.clone(), this.cannonMat, 1.4);
        break;
      case 'aura':
        // GUARD: raise an absorbing aura (soaks damage, no counter).
        this.playerAura = chip.damage;
        this.playerAuraT = 5.0;
        this.showAura();
        break;
      case 'riptide': {
        // STRIKE: punishes an enemy pinned to its back two columns.
        const bonus = this.enemyPos.col >= COLS - 2 ? 40 : 0;
        this.spawnProjectile('player', row, 17, chip.damage + bonus, this.waterMat, 0.95);
        break;
      }
      case 'slow':
        // TEMPO: halve the enemy's action/move speed for a window.
        if (this.tryControlEnemy('slow', 4.0)) this.spawnEffect(this.enemy.position.clone(), this.busterMat, 1.3);
        this.damageEnemy(chip.damage);
        break;
      case 'cleanse':
        // SUPPORT: purge your own debuffs and resist new ones briefly.
        this.playerFreezeT = 0; this.playerMarkT = 0;
        this.playerResistT = 3.0;
        this.spawnEffect(this.player.position.clone(), this.guardMat, 1.3);
        break;
    }
    this.updateHUD();
  }

  // --- Aegis barrier visuals + DataMine placement ---
  private showGuard() {
    if (!this.guardSprite) {
      this.guardSprite = new THREE.Sprite(this.guardMat.clone());
      this.guardSprite.scale.set(1.6, 2.0, 1);
      this.scene.add(this.guardSprite);
    }
    this.guardSprite.visible = true;
  }

  private showAura() {
    if (!this.auraSprite) {
      const m = this.guardMat.clone();
      m.opacity = 0.4;
      this.auraSprite = new THREE.Sprite(m);
      this.auraSprite.scale.set(2.1, 2.6, 1);
      this.scene.add(this.auraSprite);
    }
    this.auraSprite.visible = true;
    this.auraSprite.position.copy(this.player.position);
    this.auraSprite.position.y += 0.1;
  }

  private placeMine(col: number, row: number, dmg: number) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.34, 6),
      new THREE.MeshBasicMaterial({ color: 0xffae3b, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(colX(col), 0.16, rowZ(row));
    this.scene.add(ring);
    this.mines.push({ col, row, dmg, marker: ring });
  }

  private mineAt(col: number, row: number): boolean {
    return this.mines.some((m) => m.col === col && m.row === row);
  }

  // shove the enemy back toward its own wall (Water blast). Stops at the first
  // tile it can't stand on so it never clips off the grid.
  private knockEnemyBack(cols: number) {
    if (this.pvp) { this.bsend('status', { knock: cols }); return; } // foe shoves itself back
    let c = this.enemyPos.col;
    for (let i = 0; i < cols; i++) {
      const n = c + 1;
      if (n <= COLS - 1 && this.grid.canStand(n, this.enemyPos.row, 'enemy')) c = n;
      else break;
    }
    if (c !== this.enemyPos.col) {
      this.enemyPos = { col: c, row: this.enemyPos.row };
      this.syncEntity(this.enemy, this.enemyPos);
      this.spawnEffect(this.enemy.position.clone(), this.waterMat, 1.2);
    }
  }

  // lay down a burning tile (volcano). It pulses, ticks damage on whoever stands
  // on it, then burns out after a few seconds.
  private placeFire(col: number, row: number, dmg: number) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE_W * 0.7, TILE_D * 0.7),
      new THREE.MeshBasicMaterial({ map: orbTexture('#fff3c0', '#ff5a1c'), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(colX(col), 0.2, rowZ(row));
    m.renderOrder = 2;
    this.scene.add(m);
    this.fires.push({ col, row, t: 4.0, tick: 0, dmg, marker: m });
  }

  private updateFires(dt: number) {
    for (const f of this.fires) {
      f.t -= dt;
      f.tick -= dt;
      const flick = 0.85 + Math.sin(f.t * 24) * 0.12 + Math.random() * 0.06;
      f.marker.scale.set(flick, flick, flick);
      (f.marker.material as THREE.MeshBasicMaterial).opacity = Math.max(0, Math.min(1, f.t)) * 0.9;
      if (f.tick <= 0) {
        f.tick = 0.5;
        if (this.enemyPos.col === f.col && this.enemyPos.row === f.row) {
          this.spawnEffect(new THREE.Vector3(colX(f.col), 1.05, rowZ(f.row)), this.boomMat, 1.0);
          this.damageEnemy(f.dmg);
        }
      }
    }
    const done = this.fires.filter((f) => f.t <= 0);
    for (const f of done) { this.scene.remove(f.marker); f.marker.geometry.dispose(); (f.marker.material as THREE.Material).dispose(); }
    this.fires = this.fires.filter((f) => f.t > 0);
  }

  private clearFires() {
    for (const f of this.fires) { this.scene.remove(f.marker); f.marker.geometry.dispose(); (f.marker.material as THREE.Material).dispose(); }
    this.fires = [];
  }

  private clearStatuses() {
    this.enemyFreezeT = 0; this.enemySlowT = 0; this.enemyMarkT = 0;
    this.playerAura = 0; this.playerAuraT = 0; this.nextChipAmp = 0;
    this.playerFreezeT = 0; this.playerMarkT = 0; this.playerResistT = 0;
    if (this.auraSprite) this.auraSprite.visible = false;
    if (this.playerFrost) this.playerFrost.visible = false;
    if (this.enemyFrost) this.enemyFrost.visible = false;
    this.renderStatuses();
  }

  // tick the setup-chip status effects (freeze / slow / mark / aura) + their cues
  private updateStatuses(dt: number) {
    if (this.enemyFreezeT > 0) {
      this.enemyFreezeT -= dt;
      if (Math.random() < dt * 7) this.spawnEffect(this.enemy.position.clone(), this.waterMat, 0.7);
    }
    if (this.enemySlowT > 0) {
      this.enemySlowT -= dt;
      if (Math.random() < dt * 4) this.spawnEffect(this.enemy.position.clone(), this.busterMat, 0.55);
    }
    if (this.enemyMarkT > 0) {
      this.enemyMarkT -= dt;
      if (Math.random() < dt * 4) this.spawnEffect(new THREE.Vector3(colX(this.enemyPos.col), 0.45, rowZ(this.enemyPos.row)), this.enemyShotMat, 0.5);
    }
    if (this.playerAuraT > 0) {
      this.playerAuraT -= dt;
      if (this.playerAuraT <= 0) { this.playerAura = 0; if (this.auraSprite) this.auraSprite.visible = false; }
    }
    if (this.auraSprite && this.auraSprite.visible) {
      this.auraSprite.position.copy(this.player.position);
      this.auraSprite.position.y += 0.1;
    }
    if (this.playerFreezeT > 0) {
      this.playerFreezeT -= dt;
      if (Math.random() < dt * 7) this.spawnEffect(this.player.position.clone(), this.waterMat, 0.7);
    }
    if (this.playerMarkT > 0) {
      this.playerMarkT -= dt;
      if (Math.random() < dt * 4) this.spawnEffect(new THREE.Vector3(colX(this.playerPos.col), 0.45, rowZ(this.playerPos.row)), this.enemyShotMat, 0.5);
    }
    if (this.playerResistT > 0) this.playerResistT -= dt;
    // ice shell over whoever is currently frozen
    this.updateFrost('player', this.playerFreezeT > 0);
    this.updateFrost('enemy', this.enemyFreezeT > 0);
    this.renderStatuses();
  }

  // a flickering icy shell sprite covering a frozen combatant
  private updateFrost(which: 'player' | 'enemy', active: boolean) {
    const ent = which === 'player' ? this.player : this.enemy;
    let f = which === 'player' ? this.playerFrost : this.enemyFrost;
    if (active) {
      if (!f) {
        f = new THREE.Sprite(this.frostMat.clone());
        f.center.copy(ent.center);
        f.renderOrder = 3;
        this.scene.add(f);
        if (which === 'player') this.playerFrost = f; else this.enemyFrost = f;
      }
      f.visible = true;
      f.center.copy(ent.center);
      f.position.copy(ent.position);
      const pulse = 1.06 + Math.sin(this.clock.elapsedTime * 9) * 0.04;
      f.scale.set(ent.scale.x * pulse, ent.scale.y * pulse, 1);
      (f.material as THREE.SpriteMaterial).opacity = 0.42 + Math.random() * 0.14;
    } else if (f) {
      f.visible = false;
    }
  }

  // small icon badges under each HP bar showing active buffs/debuffs + timers
  private renderStatuses() {
    const fmt = (t: number) => `<span class="t">${t.toFixed(1)}</span>`;
    const pe = this.hud?.querySelector('#status-player') as HTMLElement | null;
    const ee = this.hud?.querySelector('#status-enemy') as HTMLElement | null;
    if (pe) {
      const out: string[] = [];
      if (this.playerAura > 0) out.push(`<div class="statusicon buff">🧿 ${Math.ceil(this.playerAura)}</div>`);
      if (this.nextChipAmp > 0) out.push(`<div class="statusicon buff">🔆</div>`);
      if (this.playerResistT > 0) out.push(`<div class="statusicon buff">🧹 ${fmt(this.playerResistT)}</div>`);
      if (this.playerFreezeT > 0) out.push(`<div class="statusicon debuff">🧊 ${fmt(this.playerFreezeT)}</div>`);
      if (this.playerMarkT > 0) out.push(`<div class="statusicon debuff">🎯 ${fmt(this.playerMarkT)}</div>`);
      pe.innerHTML = out.join('');
    }
    if (ee) {
      const out: string[] = [];
      if (this.enemyDef.resist) out.push(`<div class="statusicon buff">🛡 ${Math.round(this.enemyDef.resist * 100)}%</div>`);
      if (this.enemyFreezeT > 0) out.push(`<div class="statusicon debuff">🧊 ${fmt(this.enemyFreezeT)}</div>`);
      if (this.enemyMarkT > 0) out.push(`<div class="statusicon debuff">🎯 ${fmt(this.enemyMarkT)}</div>`);
      if (this.enemySlowT > 0) out.push(`<div class="statusicon debuff">🐌 ${fmt(this.enemySlowT)}</div>`);
      ee.innerHTML = out.join('');
    }
  }

  // enemy-side columns currently held by the player (drives the draw bonus)
  private territoryBonus(): number {
    let owned = 0;
    for (let c = 0; c < COLS; c++) {
      if (!PLAYER_COLS.includes(c) && this.grid.owner(c, 2) === 'player') owned++;
    }
    return Math.min(3, owned);
  }

  private updateGuard(dt: number) {
    if (this.guardT > 0) {
      this.guardT -= dt;
      if (this.guardSprite) {
        this.guardSprite.position.set(this.player.position.x + 0.7, this.player.position.y, this.player.position.z);
        const pulse = 1 + Math.sin(this.clock.elapsedTime * 12) * 0.06;
        this.guardSprite.scale.set(1.6 * pulse, 2.0 * pulse, 1);
      }
      if (this.guardT <= 0 && this.guardSprite) this.guardSprite.visible = false;
    }
  }

  // returns true if the barrier ate the hit (and fired a counter)
  private tryBlock(): boolean {
    if (this.guardT <= 0) return false;
    this.guardT = 0;
    if (this.guardSprite) this.guardSprite.visible = false;
    this.spawnEffect(this.player.position.clone(), this.guardMat, 1.8);
    if (this.guardCounter > 0) {
      this.spawnProjectile('player', this.playerPos.row, 20, this.guardCounter, this.slashMat, 0.9);
    }
    return true;
  }

  private updateMines() {
    const hit = this.mines.filter((m) => this.enemyPos.col === m.col && this.enemyPos.row === m.row);
    for (const m of hit) {
      this.spawnEffect(new THREE.Vector3(colX(m.col), 1.15, rowZ(m.row)), this.boomMat, 1.5);
      this.damageEnemy(m.dmg);
      this.grid.crack(m.col, m.row);
      this.scene.remove(m.marker); m.marker.geometry.dispose(); (m.marker.material as THREE.Material).dispose();
    }
    if (hit.length) this.mines = this.mines.filter((m) => !hit.includes(m));
  }

  private clearMines() {
    for (const m of this.mines) { this.scene.remove(m.marker); m.marker.geometry.dispose(); (m.marker.material as THREE.Material).dispose(); }
    this.mines = [];
  }

  // --- enemy side of the triangle: Guard (block + counter) and Breach ---
  private enemyRaiseGuard() {
    this.enemyGuardT = 2.4;
    this.enemyGuardCounter = 36;
    if (!this.enemyGuardSprite) {
      const m = this.guardMat.clone();
      m.color.set(0xff8fb0); // pink barrier for the enemy
      this.enemyGuardSprite = new THREE.Sprite(m);
      this.enemyGuardSprite.scale.set(1.6, 2.0, 1);
      this.scene.add(this.enemyGuardSprite);
    }
    this.enemyGuardSprite.visible = true;
  }

  private tryEnemyBlock(): boolean {
    if (this.enemyGuardT <= 0) return false;
    this.enemyGuardT = 0;
    if (this.enemyGuardSprite) this.enemyGuardSprite.visible = false;
    this.spawnEffect(this.enemy.position.clone(), this.enemyShotMat, 1.6);
    if (this.enemyGuardCounter > 0) this.spawnProjectile('enemy', this.enemyPos.row, 18, this.enemyGuardCounter, this.enemyShotMat, 0.9);
    return true;
  }

  private enemyBreach() {
    // line up on the player's row and fire an unblockable piercing shot that
    // ignores the player's Aegis — the punish for guarding predictably.
    this.enemyAnim.triggerAttack();
    const row = this.playerPos.row;
    const lane = this.tilesFor('enemy').filter((t) => t.row === row);
    if (lane.length) this.moveEnemyTo(lane.reduce((a, b) => (a.col < b.col ? a : b)));
    this.spawnProjectile('enemy', row, 22, 28, this.enemyShotMat, 1.1, true);
  }

  private updateEnemyGuard(dt: number) {
    if (this.enemyGuardT > 0) {
      this.enemyGuardT -= dt;
      if (this.enemyGuardSprite) {
        this.enemyGuardSprite.position.set(this.enemy.position.x - 0.7, this.enemy.position.y, this.enemy.position.z);
        const pulse = 1 + Math.sin(this.clock.elapsedTime * 12) * 0.06;
        this.enemyGuardSprite.scale.set(1.6 * pulse, 2.0 * pulse, 1);
      }
      if (this.enemyGuardT <= 0 && this.enemyGuardSprite) this.enemyGuardSprite.visible = false;
    }
  }

  // The enemy's RPS decision each fire window.
  private enemyAct() {
    if (this.guardT > 0) {
      this.enemyBreach();                 // punish a raised Aegis
      this.enemyFireCd = 1.4 + Math.random() * 0.8;
    } else if (this.enemyGuardT <= 0 && this.charging && this.chargeT > CHARGE_TELEGRAPH) {
      this.enemyRaiseGuard();             // read the charge telegraph and block
      this.enemyFireCd = 1.2 + Math.random() * 0.6;
    } else if (this.enemyGuardT <= 0 && Math.random() < 0.18) {
      this.enemyRaiseGuard();             // occasional pre-emptive guard (baitable)
      this.enemyFireCd = 1.2 + Math.random() * 0.6;
    } else if (this.enemyDef.status && Math.random() < 0.3 && this.statusReady(this.enemyDef.status)) {
      this.castStatus(this.enemyDef.status); // debuff you, then capitalize next turn
      this.enemyFireCd = 1.6 + Math.random() * 0.8;
    } else {
      this.runPattern(this.enemyDef.pattern); // normal Strike
      this.enemyFireCd = this.patternCooldown(this.enemyDef.pattern);
    }
  }

  // don't re-cast a debuff that's already ticking on the player
  private statusReady(s: 'snare' | 'hex'): boolean {
    return s === 'snare' ? this.playerFreezeT <= 0 : this.playerMarkT <= 0;
  }

  // fire a slow, dodgeable status shot down the player's row. Guarding cleanses it.
  private castStatus(s: 'snare' | 'hex') {
    this.enemyAnim.triggerAttack();
    const row = this.playerPos.row;
    if (s === 'snare') this.spawnProjectile('enemy', row, 10, 8, this.waterMat, 0.85, false, 0, 0, 1.4, 0);
    else this.spawnProjectile('enemy', row, 13, 12, this.enemyShotMat, 0.75, false, 0, 0, 0, 4.0);
  }

  // --- player buster charge telegraph (glow grows as you hold) ---
  private updateCharge() {
    const show = this.charging && !this.chargeConsumed && this.chargeT > 0.12;
    if (show) {
      if (!this.chargeSprite) {
        this.chargeSprite = new THREE.Sprite(this.guardMat.clone());
        this.scene.add(this.chargeSprite);
      }
      this.chargeSprite.visible = true;
      const full = this.chargeT >= CHARGE_FULL;
      const k = Math.min(1, this.chargeT / CHARGE_FULL);
      const sz = 0.5 + k * 1.0 + (full ? Math.sin(this.clock.elapsedTime * 18) * 0.12 : 0);
      this.chargeSprite.scale.set(sz, sz, 1);
      (this.chargeSprite.material as THREE.SpriteMaterial).color.set(full ? 0xfff0a0 : 0x9be7ff);
      this.chargeSprite.position.set(this.player.position.x + 0.6, this.player.position.y, this.player.position.z);
    } else if (this.chargeSprite) {
      this.chargeSprite.visible = false;
    }
  }

  // instant hit on specific grid tiles (sword/shotgun/bomb); optionally cracks
  // them. STRIKE hits are eaten by the enemy's guard; BREACH hits punch through.
  private meleeTiles(tiles: Array<[number, number]>, damage: number, mat: THREE.SpriteMaterial, size: number, crack = false, breach = false) {
    for (const [c, r] of tiles) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      this.spawnEffect(new THREE.Vector3(colX(c), 1.15, rowZ(r)), mat, size);
      if (this.pvp) this.bsend('fx', { kind: this.kindOfMat(mat), col: c, row: r, size }); // foe sees the slash
      if (this.enemyPos.col === c && this.enemyPos.row === r) {
        if (breach || !this.tryEnemyBlock()) this.damageEnemy(damage);
      }
      if (crack) this.grid.crack(c, r);
    }
  }

  private spawnProjectile(owner: 'player' | 'enemy', row: number, speed: number, damage: number, mat: THREE.SpriteMaterial, size: number, breach = false, heal = 0, knock = 0, freeze = 0, mark = 0) {
    const dir: 1 | -1 = owner === 'player' ? 1 : -1;
    const startCol = owner === 'player' ? this.playerPos.col : this.enemyPos.col;
    const s = new THREE.Sprite(mat.clone());
    s.scale.set(size, size, 1);
    s.position.set(colX(startCol) + dir * 0.5, 1.1, rowZ(row));
    this.scene.add(s);
    this.projectiles.push({ sprite: s, row, dir, speed, damage, owner, alive: true, breach, heal, knock, freeze, mark });
    // PvP: mirror my buster/cannon shots to the foe so they see them incoming
    if (this.pvp && owner === 'player') this.bsend('shot', { kind: this.kindOfMat(mat), row, speed, size });
  }

  private kindOfMat(mat: THREE.SpriteMaterial): string {
    if (mat === this.cannonMat) return 'cannon';
    if (mat === this.boomMat) return 'boom';
    if (mat === this.slashMat) return 'slash';
    if (mat === this.waterMat) return 'water';
    if (mat === this.guardMat) return 'guard';
    return 'buster';
  }

  private spawnEffect(pos: THREE.Vector3, mat: THREE.SpriteMaterial, size: number) {
    const s = new THREE.Sprite(mat.clone());
    s.position.copy(pos);
    s.scale.set(size, size, 1);
    this.scene.add(s);
    this.effects.push({ sprite: s, life: 0, ttl: 0.3, grow: size * 1.8 });
  }

  // hardened foes roll their resist to shrug off control ops
  private enemyResists(): boolean {
    const r = this.enemyDef.resist ?? 0;
    return r > 0 && Math.random() < r;
  }

  // apply a control debuff to the enemy unless it resists (flash + return false)
  private tryControlEnemy(kind: 'freeze' | 'mark' | 'slow', dur: number): boolean {
    if (this.pvp) {
      if (kind === 'freeze') this.bsend('hit', { damage: 0, freeze: dur });
      else if (kind === 'mark') this.bsend('hit', { damage: 0, mark: dur });
      return true; // friendly duel: no resist roll
    }
    if (this.enemyResists()) {
      this.spawnEffect(this.enemy.position.clone(), this.guardMat, 1.3); // resisted!
      return false;
    }
    if (kind === 'freeze') this.enemyFreezeT = dur;
    else if (kind === 'mark') this.enemyMarkT = dur;
    else this.enemySlowT = dur;
    return true;
  }

  private damageEnemy(d: number) {
    if (this.over) return;
    // PvP: the foe owns its own HP — send the hit; their client applies it (and
    // its own mark amp) and broadcasts the new HP back via pstate.
    if (this.pvp) { this.enemyAnim.triggerHit(); this.bsend('hit', { damage: d }); return; }
    if (this.enemyMarkT > 0) d = Math.round(d * 1.5); // Exploit Tag amplifies your hits
    this.enemyHP -= d;
    this.enemyAnim.triggerHit();
    if (this.enemyHP <= 0) { this.enemyHP = 0; this.endBattle(true); }
    this.updateHUD();
  }

  private damagePlayer(d: number) {
    if (this.over) return;
    if (this.playerMarkT > 0) d = Math.round(d * 1.5); // Hex amplifies what hits you
    // Sentinel aura soaks incoming damage before it reaches integrity
    if (this.playerAura > 0) {
      const soak = Math.min(this.playerAura, d);
      this.playerAura -= soak; d -= soak;
      this.spawnEffect(this.player.position.clone(), this.guardMat, 1.0);
      if (this.playerAura <= 0) { this.playerAuraT = 0; if (this.auraSprite) this.auraSprite.visible = false; }
      if (d <= 0) { this.updateHUD(); return; }
    }
    this.playerHP -= d;
    this.playerAnim.triggerHit();
    if (this.playerHP <= 0) { this.playerHP = 0; this.endBattle(false); }
    this.updateHUD();
  }

  // ---------------- Enemy AI ----------------
  private tilesFor(who: 'player' | 'enemy'): Array<{ col: number; row: number }> {
    const out: Array<{ col: number; row: number }> = [];
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      if (!this.grid.canStand(c, r, who)) continue;
      if (who === 'enemy' && this.mineAt(c, r)) continue; // smart enemies route around DataMines
      out.push({ col: c, row: r });
    }
    return out;
  }

  private moveEnemyTo(tile: { col: number; row: number }) {
    const prev = { ...this.enemyPos };
    this.enemyPos = { ...tile };
    this.syncEntity(this.enemy, this.enemyPos);
    this.grid.leave(prev.col, prev.row);
  }

  private updateEnemy(dt: number) {
    if (this.paused || this.over) return;
    if (this.enemyFreezeT > 0) return; // Deadlock: no move, no act this frame

    // Throttle Core slows the enemy's clocks to half speed.
    const edt = this.enemySlowT > 0 ? dt * 0.5 : dt;

    this.enemyMoveCd -= edt;
    if (this.enemyMoveCd <= 0) {
      const tiles = this.tilesFor('enemy');
      if (tiles.length) this.moveEnemyTo(tiles[Math.floor(Math.random() * tiles.length)]);
      this.enemyMoveCd = 1.0 + Math.random() * 1.3;
    }

    this.enemyFireCd -= edt;
    if (this.enemyFireCd <= 0) {
      this.enemyAct();
    }
  }

  private patternCooldown(p: Pattern): number {
    const base: Record<Pattern, number> = { shot: 1.4, dash: 1.9, smash: 1.7, spin: 2.2, bombrun: 2.4, pincer: 2.6 };
    return base[p] + Math.random() * 0.8;
  }

  private runPattern(p: Pattern) {
    this.enemyAnim.triggerAttack();
    const erow = this.enemyPos.row;
    switch (p) {
      case 'shot':
        this.spawnProjectile('enemy', erow, 9 + Math.random() * 3, 20, this.enemyShotMat, 0.7);
        break;
      case 'dash': {
        // line up with the player's row, then lunge a fast wide shot down it
        const row = this.playerPos.row;
        const lane = this.tilesFor('enemy').filter((t) => t.row === row);
        if (lane.length) this.moveEnemyTo(lane.reduce((a, b) => (a.col < b.col ? a : b)));
        this.spawnProjectile('enemy', row, 24, 26, this.enemyShotMat, 1.15);
        break;
      }
      case 'smash':
        // telegraphed slam on wherever the player is standing — dodge it
        this.spawnTileStrike(this.playerPos.col, this.playerPos.row, 0.55, 30, true);
        break;
      case 'spin': {
        // pirouette of shots down three rows at once
        for (const dr of [-1, 0, 1]) {
          const row = erow + dr;
          if (row >= 0 && row < ROWS) this.spawnProjectile('enemy', row, 11, 16, this.enemyShotMat, 0.6);
        }
        break;
      }
      case 'bombrun': {
        // carpet-bomb three random player panels
        const targets = this.shuffleTiles(this.tilesFor('player')).slice(0, 3);
        for (const t of targets) this.spawnTileStrike(t.col, t.row, 0.8, 22, true);
        break;
      }
      case 'pincer': {
        // pincers strike the top and bottom rows in the player's column...
        const col = this.playerPos.col;
        this.spawnTileStrike(col, 0, 0.7, 26, true);
        this.spawnTileStrike(col, ROWS - 1, 0.7, 26, true);
        // ...and occasionally claw back a column
        if (Math.random() < 0.3) {
          const stolen = this.grid.grabForEnemy();
          if (stolen >= 0 && this.grid.owner(this.playerPos.col, this.playerPos.row) === 'enemy') {
            const spot = this.grid.anyStandable('player', this.playerPos.row);
            if (spot) { this.playerPos = spot; this.syncEntity(this.player, this.playerPos); }
          }
        }
        break;
      }
    }
  }

  private shuffleTiles<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // A delayed AoE: shows a warning ring, then hits the tile (and cracks it).
  private spawnTileStrike(col: number, row: number, delay: number, damage: number, crack: boolean) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.46, 24),
      new THREE.MeshBasicMaterial({ color: 0xff3b5c, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(colX(col), 0.18, rowZ(row));
    this.scene.add(ring);
    this.strikes.push({ col, row, t: delay, damage, crack, marker: ring });
  }

  private updateStrikes(dt: number) {
    for (const s of this.strikes) {
      s.t -= dt;
      const pulse = 1 + Math.sin(s.t * 22) * 0.18;
      s.marker.scale.set(pulse, pulse, pulse);
      if (s.t <= 0) {
        this.spawnEffect(new THREE.Vector3(colX(s.col), 1.15, rowZ(s.row)), this.boomMat, 1.4);
        if (this.playerPos.col === s.col && this.playerPos.row === s.row) {
          if (!this.tryBlock()) this.damagePlayer(s.damage);
        }
        if (s.crack) this.grid.crack(s.col, s.row);
      }
    }
    const done = this.strikes.filter((s) => s.t <= 0);
    for (const s of done) { this.scene.remove(s.marker); s.marker.geometry.dispose(); (s.marker.material as THREE.Material).dispose(); }
    this.strikes = this.strikes.filter((s) => s.t > 0);
  }

  private clearStrikes() {
    for (const s of this.strikes) { this.scene.remove(s.marker); s.marker.geometry.dispose(); (s.marker.material as THREE.Material).dispose(); }
    this.strikes = [];
  }

  // ---------------- Loop ----------------
  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.sprite.position.x += p.dir * p.speed * dt;
      const x = p.sprite.position.x;
      if (p.owner === 'player') {
        if (this.enemyPos.row === p.row && x >= colX(this.enemyPos.col) - 0.4) {
          if (p.breach || !this.tryEnemyBlock()) {
            this.damageEnemy(p.damage);
            if (p.heal) { this.playerHP = Math.min(this.playerHPMax, this.playerHP + p.heal); this.spawnEffect(this.player.position.clone(), this.slashMat, 0.9); this.updateHUD(); }
            if (p.knock) this.knockEnemyBack(p.knock);
          }
          p.alive = false;
        } else if (x > colX(COLS - 1) + 1) p.alive = false;
      } else {
        if (this.playerPos.row === p.row && x <= colX(this.playerPos.col) + 0.4) {
          if (p.breach || !this.tryBlock()) {
            this.damagePlayer(p.damage);
            // status riders only land on an unblocked hit (guard cleanses them)
            // and are shrugged off entirely while Rollback resist is active.
            if (this.playerResistT <= 0) {
              if (p.freeze) { this.playerFreezeT = p.freeze; this.spawnEffect(this.player.position.clone(), this.waterMat, 1.5); }
              if (p.mark) { this.playerMarkT = p.mark; this.spawnEffect(this.player.position.clone(), this.enemyShotMat, 1.4); }
            } else if (p.freeze || p.mark) {
              this.spawnEffect(this.player.position.clone(), this.guardMat, 1.1); // resisted!
            }
          }
          p.alive = false;
        } else if (x < colX(0) - 1) p.alive = false;
      }
    }
    for (const p of this.projectiles) {
      if (!p.alive) { this.scene.remove(p.sprite); (p.sprite.material as THREE.Material).dispose(); }
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  private updateEffects(dt: number) {
    for (const e of this.effects) {
      e.life += dt;
      const t = e.life / e.ttl;
      const sc = THREE.MathUtils.lerp(e.sprite.scale.x, e.grow, 0.4);
      e.sprite.scale.set(sc, sc, 1);
      (e.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - t);
    }
    const dead = this.effects.filter((e) => e.life >= e.ttl);
    for (const e of dead) { this.scene.remove(e.sprite); (e.sprite.material as THREE.Material).dispose(); }
    this.effects = this.effects.filter((e) => e.life < e.ttl);
  }

  private updateAnims(dt: number) {
    this.playerAnim.update(dt);
    this.enemyAnim.update(dt);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (!this.paused && !this.over) {
      if (this.custom < CUSTOM_TIME) {
        this.custom = Math.min(CUSTOM_TIME, this.custom + dt);
        this.updateHUD();
      }
      this.handleInput(dt);
      if (this.pvp) this.netSync(dt);
      else this.updateEnemy(dt);
      this.updateProjectiles(dt);
      this.updateStrikes(dt);
      this.updateMines();
      this.updateFires(dt);
      this.updateStatuses(dt);
      this.updateGuard(dt);
      this.updateEnemyGuard(dt);
      this.updateCharge();
      this.grid.update(dt);
    } else {
      this.handleInput(dt); // still lets Space/menu work; it no-ops when paused
    }
    this.updateEffects(dt);
    this.updateAnims(dt);

    this.composer.render();
  };

  private endBattle(win: boolean) {
    if (this.over) return;
    this.over = true;
    if (this.pvp && !win) this.bsend('over'); // tell the foe they won
    if (win) this.playerAnim.triggerVictory();
    this.clearStrikes();
    this.clearMines();
    this.clearFires();
    this.clearStatuses();
    this.guardT = 0; if (this.guardSprite) this.guardSprite.visible = false;
    this.enemyGuardT = 0; if (this.enemyGuardSprite) this.enemyGuardSprite.visible = false;
    this.charging = false; this.chargeT = 0; this.chargeConsumed = false;
    if (this.chargeSprite) this.chargeSprite.visible = false;

    // bounty: tougher foes pay out more Credits (spend them in the Agent shop)
    const reward = win ? Math.round(this.enemyHPMax / 6) : 0;
    if (reward) addCredits(reward);
    if (win && this.encounter && !this.pvp) addWin(); // PvE wins count toward the quest
    const bounty = reward ? `<div class="bounty">+◈ ${reward} credits</div>` : '';

    this.result.className = 'show ' + (win ? 'win' : 'lose');
    if (this.encounter) {
      this.result.innerHTML = `
        <h1>${win ? 'VICTORY' : 'DELETED'}</h1>
        <p>${win ? 'The intruder is data now.' : 'You wash back to the hollow…'}</p>
        ${bounty}
        <button class="btn" id="leave">Return to map</button>`;
      (this.result.querySelector('#leave') as HTMLElement).onclick = () => {
        this.dispose();
        this.onExit?.();
      };
    } else {
      this.result.innerHTML = `
        <h1>${win ? 'VICTORY' : 'DELETED'}</h1>
        <p>${win ? 'Deleted. Next challenger approaches…' : 'Your signal was lost to the abyss.'}</p>
        ${bounty}
        <button class="btn" id="again">${win ? 'Next opponent' : 'Rematch'}</button>`;
      (this.result.querySelector('#again') as HTMLElement).onclick = () => this.reset();
    }
  }

  private reset() {
    this.playerHP = this.playerHPMax;
    this.enemyIndex = (this.enemyIndex + 1) % ENEMY_ROSTER.length; // next opponent each rematch
    this.applyEnemy(ENEMY_ROSTER[this.enemyIndex]);
    this.playerPos = { col: 2, row: 2 };
    this.enemyPos = { col: 7, row: 2 };
    this.syncEntity(this.player, this.playerPos);
    this.syncEntity(this.enemy, this.enemyPos);
    this.queue = [];
    this.custom = CUSTOM_TIME;
    for (const p of this.projectiles) this.scene.remove(p.sprite);
    this.projectiles = [];
    this.clearStrikes();
    this.clearMines();
    this.clearFires();
    this.clearStatuses();
    this.guardT = 0; if (this.guardSprite) this.guardSprite.visible = false;
    this.enemyGuardT = 0; if (this.enemyGuardSprite) this.enemyGuardSprite.visible = false;
    this.charging = false; this.chargeT = 0; this.chargeConsumed = false;
    this.playerAnim.clearOneShot(); // drop the held victory pose
    this.over = false; this.paused = false;
    this.result.className = '';
    this.updateHUD();
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.net?.clearHandlers(); // stop receiving battle msgs (main closes the socket)
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('blur', this.onBlur);
    this.renderer.domElement.removeEventListener('mousedown', this.onMouseDown);
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu);
    this.clearStrikes();
    this.clearMines();
    for (const el of [this.hud, this.customWindow, this.result, this.walletTag]) el?.remove();
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }
}
