import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Vignette + gentle desaturate/contrast grade for cohesion (HD-2D "premium" feel).
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, darkness: { value: 1.15 }, sat: { value: 0.9 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float darkness; uniform float sat; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = clamp(1.0 - dot(d, d) * darkness, 0.0, 1.0);   // radial vignette
      c.rgb *= mix(0.6, 1.0, v);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));         // slight desaturate
      c.rgb = mix(vec3(l), c.rgb, sat);
      c.rgb = (c.rgb - 0.5) * 1.07 + 0.5;                      // a touch of contrast
      gl_FragColor = c;
    }`,
};
import { textures, orbTexture, humanoidTexture, humanoidCanvas, humanoidWalkTexture, WALK_FRAMES } from './sprites.ts';
import { SpriteAnim } from './anim.ts';
import { ENEMY_COUNT } from './battle.ts';
import {
  CHARACTERS, getSelectedCharacter, setSelectedCharacter,
  getCredits, addCredits, buyCharacter, isOwned, characterById, tintColor,
  BODIES, getSelectedBody, setSelectedBody,
} from './characters.ts';
import type { AgentBody } from './sprites.ts';
import type { Session } from './wallet.ts';
import {
  getShards, collectShard, getCaches, lootCache, getBeacons, discoverBeacon,
  getWins, getQuestStage, setQuestStage, getQuestBaseWins, setQuestBaseWins,
  getPos, savePos,
} from './progress.ts';
import { NetClient, defaultMpUrl, type PeerState } from './net.ts';
import { openDeckBuilder } from './deckbuilder.ts';
import { openChipShop } from './shop.ts';
import { openOps } from './ops.ts';
import { initTide, getTide, getClearance, decorateName } from './tide.ts';
import { openSettings } from './settings.ts';

const BOUNDS = { x: 28, z: 19 };  // expanded play area
const SPEED = 6.4;
const RUN_MULT = 1.75;   // Shift = run
type Dir = 'down' | 'up' | 'left' | 'right';

// Three concentric difficulty regions (by distance from the spawn core). The
// farther out you roam, the nastier the processes — and the richer the loot.
const REGIONS = [
  { name: 'INNER FLATS', maxR: 14, enemies: [0, 1, 2] },
  { name: 'OUTER GRID',  maxR: 26, enemies: [3, 4, 5] },
  { name: 'DEEP SECTORS', maxR: 999, enemies: [6, 7, 8, 9] },
];
function regionAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  return REGIONS.findIndex((g) => r < g.maxR);
}

// Quest "The Lost Index" — recover every shard, crack every cache, purge a few
// storms. Targets are filled in once the world is built (shard/cache counts).
const QUEST_STORMS = 3;

interface Prop { sprite: THREE.Sprite; storm: boolean; pos: THREE.Vector2; tier: number; }

// A fast-travel beacon: discovered by walking up to it, warp between discovered ones.
interface Beacon { idx: number; name: string; pos: THREE.Vector2; sprite: THREE.Sprite; }

// Another player, mirrored from the relay: their agent sprite + name tag, lerped
// toward the latest networked position.
interface Remote {
  id: number; name: string; body: AgentBody; tint: string;
  sprite: THREE.Sprite; anim: SpriteAnim; label: THREE.Sprite;
  cur: THREE.Vector2; target: THREE.Vector2;
  facing: Dir; moving: boolean; running: boolean;
  dirTex: Record<Dir, THREE.Texture>; walkTex: Record<Dir, THREE.Texture>;
}

// Anything you can walk up to and press E on (NPCs, vendors, loot caches).
interface Interactable {
  pos: THREE.Vector2;
  sprite: THREE.Sprite;
  radius: number;
  baseY: number;
  bob: number;
  phase: number;
  prompt: () => string;     // hint text (live, so a looted cache can re-label)
  action: () => void;       // run on E
}

interface Shard { sprite: THREE.Sprite; pos: THREE.Vector2; baseY: number; taken: boolean; }

export interface PvpInfo {
  role: 'host' | 'guest';
  net: NetClient;
  oppId: number; oppName: string; oppBody: string; oppTint: string;
}

export interface OverworldOpts {
  onEncounter: (enemyIndex: number) => void;
  onPvp?: (info: PvpInfo) => void;
  onPortal?: () => void;   // step into the roguelike dungeon portal
}

// HD-2D alien digital planet: free-roam a large glowing data-continent split into
// escalating sectors, chat with the resident processes, crack data-caches for
// Credits, hunt scattered data-shards, and stir up battles in the data-storms.
// 2D pixel sprites in a 3D diorama with bloom + fog, Octopath-Traveler style.
export class OverworldScene {
  private renderer: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private bokeh!: BokehPass;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;

  private player!: THREE.Sprite;
  private playerAnim!: SpriteAnim;
  private pos = new THREE.Vector2(0, 6);
  private props: Prop[] = [];
  private actors: Interactable[] = [];
  private shards: Shard[] = [];
  private shardTotal = 0;
  private cacheTotal = 0;
  private currentActor: Interactable | null = null;
  private motes!: THREE.Points;
  private regionIdx = -1;
  private beacons: Beacon[] = [];
  private warpOpen = false;
  private warpEl?: HTMLElement;
  private questEl?: HTMLElement;
  private deckOpen = false;
  private shopOpen = false;
  private opsOpen = false;
  private settingsOpen = false;
  private tideEl?: HTMLElement;
  private saveT = 0;

  // multiplayer presence
  private session!: Session;
  private net?: NetClient;
  private peers = new Map<number, Remote>();
  private onlineEl?: HTMLElement;
  private currentPeer: Remote | null = null;
  private challengeOutTo = 0;          // peer id we've challenged (awaiting reply)
  private challengeEl?: HTMLElement;    // incoming-challenge modal
  private inPvp = false;               // handing off to a PvP battle

  // orbit camera: distance (wheel zoom) + yaw/pitch (click-drag)
  private camDist = 26;
  private camYaw = 0;
  private camPitch = 0.62;       // look-down angle that frames the floating diorama (lower = more cliff face shown)
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  private keys: Record<string, boolean> = {};
  private fresh: string[] = [];
  private encMeter = 0;
  private grace = 0.5;
  private talking = false;
  private done = false;
  private rosterOpen = false;
  private rosterEl?: HTMLElement;
  private creditsEl?: HTMLElement;
  private shardEl?: HTMLElement;
  private toastEl?: HTMLElement;
  private toastT = 0;
  private facing: Dir = 'down';
  private dirTex!: Record<Dir, THREE.Texture>; // front/back/left/right idle views
  private walkTex!: Record<Dir, THREE.Texture>; // front/back/left/right walk strips

  private dom: HTMLElement[] = [];
  private prompt!: HTMLElement;
  private dialogue!: HTMLElement;
  private dialogueLines: string[] = [];
  private lineIdx = 0;

  constructor(private container: HTMLElement, session: Session, private opts: OverworldOpts) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 320);

    this.session = session;
    initTide(session.address); // wallet-scoped ◊ TIDE ledger
    this.build();
    this.buildPost();
    this.buildHUD(session);
    this.connectNet();

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false });
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    if (new URLSearchParams(location.search).has('dev')) (window as { __ow?: OverworldScene }).__ow = this;
    this.loop();
  }

  // dev helper: jump to a world position (used for headless QA)
  teleport(x: number, z: number) {
    this.pos.set(THREE.MathUtils.clamp(x, -BOUNDS.x, BOUNDS.x), THREE.MathUtils.clamp(z, -BOUNDS.z, BOUNDS.z));
    this.syncPlayer();
    this.updateCamera(true);
  }

  private build() {
    // light haze only — the diorama slab should be VISIBLE floating in the void
    // (Octopath HD-2D), not fogged out. Pushed out for the larger continent.
    this.scene.fog = new THREE.Fog(0x0b0a20, 60, 170);
    this.scene.background = textures.alienSky();
    this.scene.backgroundIntensity = 0.4; // dim the nebula so the slab reads as the subject

    // HD-2D diorama: the world sits on a raised terrain SLAB with thick, visible
    // cliff edges (like an Octopath floating tabletop), not an infinite plane.
    const top = textures.alienGround();
    top.wrapS = top.wrapT = THREE.RepeatWrapping; top.repeat.set(9, 7);
    const cliff = textures.alienCliff();
    cliff.repeat.set(12, 1);
    const topMat = new THREE.MeshStandardMaterial({
      map: top, emissiveMap: top, emissive: 0x2f4ec0, emissiveIntensity: 0.45,
      color: 0x6b78ad, roughness: 1, metalness: 0.05,
    });
    const cliffMat = new THREE.MeshStandardMaterial({
      map: cliff, emissiveMap: cliff, emissive: 0x6a3aff, emissiveIntensity: 0.5,
      color: 0x342a52, roughness: 1,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x06050d, roughness: 1 });
    // BoxGeometry face order: [+x, -x, +y(top), -y(bottom), +z, -z]
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(62, 6, 44),
      [cliffMat, cliffMat, topMat, darkMat, cliffMat, cliffMat],
    );
    slab.position.y = -3; // top surface sits at y = 0 where sprites stand
    slab.receiveShadow = true;
    this.scene.add(slab);

    // lighting — low cool ambient (keeps the ground in shadow so glow pops) +
    // a soft key, plus accent rims spread across the bigger map.
    this.scene.add(new THREE.AmbientLight(0x474e80, 1.0));
    const sun = new THREE.DirectionalLight(0xc8d4ff, 0.9);
    sun.position.set(-6, 16, 8);
    this.scene.add(sun);
    const accents: Array<[number, number, number, number, number]> = [
      [0x2fd6ff, 5, 6, 5, 48],     // cyan core
      [0xc44ff0, -8, 6, -3, 44],   // magenta core
      [0xffb070, 0, 5, 9, 40],     // warm key (Octopath lantern feel)
      [0x2fd6ff, 19, 7, -10, 54],  // far cyan
      [0xc44ff0, -20, 7, 9, 54],   // far magenta
    ];
    for (const [c, x, y, z, r] of accents) {
      const l = new THREE.PointLight(c, 16, r);
      l.position.set(x, y, z);
      this.scene.add(l);
    }

    // scenery spread across the whole continent
    const crystalSpots: Array<[number, number]> = [
      [8, -3], [-10, 4], [13, -5], [18, 10], [-19, -6], [22, 2],
      [-23, 12], [10, 16], [-8, -13], [25, -8], [-26, 0], [16, -13],
    ];
    for (const [x, z] of crystalSpots) this.addProp(textures.crystal(), x, z, 3.2, false, 0);
    const spireSpots: Array<[number, number]> = [
      [11, 3], [-3, 5], [-13, -3], [20, -2], [-20, 8], [15, 13], [-17, -12], [26, 11],
    ];
    for (const [x, z] of spireSpots) this.addProp(textures.spire(), x, z, 4.4, false, 0);
    // data-storms (battle zones) — tiered by region; kept clear of NPCs/caches
    // so you're never ambushed mid-conversation or mid-loot.
    const stormSpots: Array<[number, number]> = [
      [4, 2], [-8, -6], [1, -3],                       // inner
      [14, -6], [-15, -8], [17, 9], [-13, 12],         // outer
      [24, -14], [-25, 4], [19, 16], [-24, -16],       // deep
    ];
    for (const [x, z] of stormSpots) {
      this.addProp(textures.alienFlora(), x, z, 3.2, true, Math.max(0, regionAt(x, z)));
    }

    // drifting data-motes for atmosphere (bright -> they bloom)
    this.motes = this.makeMotes();
    this.scene.add(this.motes);

    // resume where we left off (persists across battle rebuilds & sessions)
    const saved = getPos();
    if (saved) this.pos.set(THREE.MathUtils.clamp(saved.x, -BOUNDS.x, BOUNDS.x),
                            THREE.MathUtils.clamp(saved.z, -BOUNDS.z, BOUNDS.z));

    // player = the selected humanoid agent (shared gpt-image-1 pixel bases, tinted
    // per shell); the idle swaps between front/back/left/right by facing direction.
    const ch = getSelectedCharacter();
    this.setCharacterTextures(tintColor(ch));
    const idle = this.dirTex[this.facing];
    this.player = this.makeSprite(idle, 3.0);
    this.scene.add(this.player);
    this.playerAnim = new SpriteAnim(this.player, {
      base: new THREE.Vector3(this.pos.x, 1.35, this.pos.y),
      scaleW: 3.0, scaleH: 3.0, facing: 1,
      idleTex: idle,
      bob: 0.06,
      walk: this.walkTex, walkFrames: WALK_FRAMES, walkFps: 9,
    });

    this.buildActors();
    this.buildShards();
    this.buildBeacons();

    this.syncPlayer();
    this.updateCamera(true);
  }

  // ---------------- world content ----------------
  private addActor(sprite: THREE.Sprite, x: number, z: number, baseY: number,
                   radius: number, prompt: () => string, action: () => void, bob = 0.05) {
    const pos = new THREE.Vector2(x, z);
    sprite.position.set(x, baseY, z);
    this.scene.add(sprite);
    this.actors.push({ pos, sprite, radius, baseY, bob, phase: Math.random() * 6.28, prompt, action });
  }

  private buildActors() {
    // The Oracle — gives & tracks the "Lost Index" quest.
    const oracle = this.makeSprite(textures.mermaid(), 2.8);
    this.addActor(oracle, -6, -2, 1.4, 2.8,
      () => (getQuestStage() === 0 ? 'Talk to the Oracle ·  !'
        : getQuestStage() === 1 && this.questComplete() ? 'Claim · The Lost Index'
        : 'Talk to the Oracle'),
      () => this.talkOracle(), 0.06);

    // The Vendor — opens the agent shop. Bright gold cortex so it reads as a
    // distinct, friendly NPC (not the dark cyber-skull player base).
    const vendor = this.makeSprite(humanoidTexture('#ffcf3a', 'front', 0.9, 'cortex'), 3.0);
    this.addActor(vendor, 7, -2, 1.5, 2.8,
      () => 'Browse the AGENT SHOP',
      () => this.openRoster());

    // The Chip Merchant — opens the CHIP SHOP (buy unlockable chips, daily deals).
    // Magenta cortex so it reads as a distinct vendor next to the gold agent shop.
    const merchant = this.makeSprite(humanoidTexture('#d96bff', 'front', 0.9, 'cortex'), 3.0);
    this.addActor(merchant, 11, -2, 1.5, 2.8,
      () => 'Browse the CHIP SHOP',
      () => this.openShop());

    // The Archivist — flavor lore, hints about shards.
    const arch = this.makeSprite(humanoidTexture('#46e0a0', 'front', 0.9, 'cortex'), 3.0);
    this.addActor(arch, -4, 11, 1.5, 2.8,
      () => 'Talk to the Archivist',
      () => this.startDialogue([
        'Archivist: "Fragments of a deleted index drift across the sectors."',
        `"Recover all ${this.shardTotal} data-shards and the cache they unlock is... generous."`,
        '"The outer grid and deep sectors hide the rest. Mind the storms."',
      ]));

    // The Dungeon Portal — a swirling rift that drops you into a freshly
    // generated roguelike maze: loot, processes, and a boss at the core.
    const portal = this.makeSprite(orbTexture('#ffd6ff', '#b03aff'), 3.6);
    this.addActor(portal, 0, -6, 2.1, 3.0,
      () => 'Enter the GRID DUNGEON ·  ▣',
      () => this.opts.onPortal?.(), 0.22);

    // Data caches — crack for Credits (once, persisted). Reward scales with depth.
    const cacheSpots: Array<[number, number]> = [
      [12, 8], [-16, 6], [20, -10], [-24, -12], [24, 14],
    ];
    this.cacheTotal = cacheSpots.length;
    const looted = getCaches();
    cacheSpots.forEach(([x, z], i) => {
      const tier = Math.max(0, regionAt(x, z));
      const reward = 40 + tier * 45 + 10 * (i % 3); // deterministic so re-loads match
      const sprite = this.makeSprite(orbTexture('#fff6d0', '#e3a626'), 1.7);
      let done = looted.has(i);
      if (done) (sprite.material as THREE.SpriteMaterial).opacity = 0.22;
      this.addActor(sprite, x, z, 1.05, 2.2,
        () => (done ? 'Data-cache · emptied' : `Crack data-cache · +◈ ${reward}`),
        () => {
          if (done) return;
          done = true;
          lootCache(i);
          addCredits(reward);
          this.updateCredits();
          (sprite.material as THREE.SpriteMaterial).opacity = 0.22;
          this.toast(`Data-cache cracked · +◈ ${reward}`);
          this.updateQuest();
        }, 0.12);
    });
  }

  private buildShards() {
    const spots: Array<[number, number]> = [
      [3, -8], [-10, -9], [15, 2], [-18, -2], [9, 15],
      [-7, 16], [22, 6], [-22, 9], [26, -4], [-26, -14],
    ];
    this.shardTotal = spots.length;
    const got = getShards();
    spots.forEach(([x, z], i) => {
      const taken = got.has(i);
      const sprite = this.makeSprite(orbTexture('#e6fcff', '#39d0ff'), 1.0);
      const baseY = 1.1;
      sprite.position.set(x, baseY, z);
      sprite.visible = !taken;
      this.scene.add(sprite);
      this.shards.push({ sprite, pos: new THREE.Vector2(x, z), baseY, taken });
    });
  }

  // ---------------- fast-travel beacons ----------------
  private buildBeacons() {
    const spots: Array<[number, number, string]> = [
      [-2, -9, 'INNER FLATS'],
      [18, 2, 'OUTER GRID'],
      [20, -17, 'DEEP SECTORS'],
    ];
    const known = getBeacons();
    spots.forEach(([x, z, name], i) => {
      const sprite = this.makeSprite(orbTexture('#ffffff', '#b07bff'), 2.3);
      const baseY = 1.7;
      sprite.position.set(x, baseY, z);
      (sprite.material as THREE.SpriteMaterial).opacity = known.has(i) ? 1 : 0.5;
      this.scene.add(sprite);
      const b: Beacon = { idx: i, name, pos: new THREE.Vector2(x, z), sprite };
      this.beacons.push(b);
      // a beacon is also an interactable: E opens the warp menu once discovered
      this.actors.push({
        pos: b.pos, sprite, radius: 2.4, baseY, bob: 0.16, phase: i * 2,
        prompt: () => (getBeacons().has(i) ? `Warp · ${name} beacon` : `Beacon · ${name} (offline)`),
        action: () => { if (getBeacons().has(i)) this.openWarp(i); },
      });
    });
  }

  private discoverBeaconsNear() {
    for (const b of this.beacons) {
      if (getBeacons().has(b.idx)) continue;
      if (this.pos.distanceTo(b.pos) < 2.4) {
        discoverBeacon(b.idx);
        (b.sprite.material as THREE.SpriteMaterial).opacity = 1;
        this.toast(`Beacon online · ${b.name}`);
      }
    }
  }

  private openWarp(fromIdx: number) {
    if (this.warpOpen) return;
    this.warpOpen = true;
    const known = [...getBeacons()];
    const items = this.beacons.filter((b) => known.includes(b.idx) && b.idx !== fromIdx);
    const list = items.map((b) =>
      `<button class="btn" data-i="${b.idx}" style="display:block;width:100%;margin:6px 0">↟ ${b.name}</button>`).join('')
      || '<div class="sub">No other beacons discovered yet — explore to bring them online.</div>';
    const el = document.createElement('div');
    el.id = 'warp';
    el.style.cssText = 'position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(4,8,18,.66)';
    el.innerHTML = `<div class="roster-panel" style="max-width:380px">
      <h2>FAST TRAVEL</h2>
      <div class="sub">Warp to a discovered beacon.</div>
      <div style="margin:14px 0">${list}</div>
      <button class="btn" data-act="close">Close · Esc</button></div>`;
    this.container.appendChild(el); this.dom.push(el);
    this.warpEl = el;
    el.querySelectorAll('[data-i]').forEach((btn) => {
      (btn as HTMLElement).onclick = () =>
        this.warpTo(this.beacons[parseInt((btn as HTMLElement).dataset.i!, 10)]);
    });
    (el.querySelector('[data-act="close"]') as HTMLElement).onclick = () => this.closeWarp();
  }

  private closeWarp() {
    this.warpOpen = false;
    if (this.warpEl) { this.warpEl.remove(); this.warpEl = undefined; }
  }

  private warpTo(b: Beacon) {
    this.pos.set(b.pos.x, b.pos.y);
    this.syncPlayer();
    this.updateCamera(true);
    savePos(this.pos.x, this.pos.y);
    this.closeWarp();
    this.checkRegion();
    this.toast(`Warped · ${b.name}`);
  }

  // ---------------- quest: The Lost Index ----------------
  private shardsGot() { return this.shards.filter((s) => s.taken).length; }
  private cachesGot() { return getCaches().size; }
  private stormsPurged() { return Math.max(0, getWins() - getQuestBaseWins()); }
  private questComplete() {
    return this.shardsGot() >= this.shardTotal
      && this.cachesGot() >= this.cacheTotal
      && this.stormsPurged() >= QUEST_STORMS;
  }

  private talkOracle() {
    const st = getQuestStage();
    if (st === 0) {
      setQuestStage(1);
      setQuestBaseWins(getWins());
      this.toast('Quest accepted · The Lost Index');
      this.updateQuest();
      this.startDialogue([
        'The Oracle: "You compiled into our world, little agent."',
        '"A deleted index lies scattered — shards adrift, caches sealed, storms standing guard."',
        `"Recover all ${this.shardTotal} shards, crack all ${this.cacheTotal} caches, and purge ${QUEST_STORMS} storms."`,
        '"Do this and I pay you in full. The map will remember your progress."',
      ]);
    } else if (st === 1 && this.questComplete()) {
      setQuestStage(2);
      addCredits(600);
      this.updateCredits();
      this.updateQuest();
      this.toast('Quest complete · +◈ 600');
      this.startDialogue([
        'The Oracle: "The index is whole again. No process could have done this."',
        '"Take 600 Credits, and my thanks. The loop is a little less broken now."',
      ]);
    } else if (st === 1) {
      this.startDialogue([
        'The Oracle: "The index is still scattered."',
        `"Shards ${this.shardsGot()}/${this.shardTotal} · Caches ${this.cachesGot()}/${this.cacheTotal} · Storms ${this.stormsPurged()}/${QUEST_STORMS}."`,
        '"Search the outer grid and the deep sectors. And mind the storms."',
      ]);
    } else {
      this.startDialogue([
        'The Oracle: "The index holds. Wander as you like, agent."',
        '"The storms still spawn fresh processes, if you crave a fight."',
      ]);
    }
  }

  private updateQuest() {
    if (!this.questEl) return;
    if (getQuestStage() !== 1) { this.questEl.style.display = 'none'; return; }
    const row = (label: string, a: number, b: number) =>
      `<div class="qrow">${a >= b ? '✓' : '•'} ${label} <b>${Math.min(a, b)}/${b}</b></div>`;
    this.questEl.style.display = 'block';
    this.questEl.innerHTML =
      '<div class="qtitle" style="color:#9cc6ff;letter-spacing:.05em;margin-bottom:5px;border-bottom:1px solid #2c4a7a;padding-bottom:4px">◇ THE LOST INDEX</div>' +
      row('Data-shards', this.shardsGot(), this.shardTotal) +
      row('Data-caches', this.cachesGot(), this.cacheTotal) +
      row('Storms purged', this.stormsPurged(), QUEST_STORMS);
  }

  // ---------------- multiplayer presence ----------------
  private connectNet() {
    const net = new NetClient(defaultMpUrl());
    this.net = net;
    net.on('welcome', (m) => { for (const p of (m.peers as PeerState[]) || []) this.addPeer(p); });
    net.on('join', (m) => this.addPeer(m as unknown as PeerState));
    net.on('state', (m) => this.onPeerState(m as unknown as PeerState));
    net.on('reskin', (m) => this.reskinPeer(m as unknown as { id: number; name: string; body: string; tint: string }));
    net.on('leave', (m) => { if ((m.id as number) === this.challengeOutTo) this.challengeOutTo = 0; this.removePeer(m.id as number); });
    net.on('down', () => this.updateOnline());
    // PvP challenge handshake
    net.on('challenge', (m) => this.incomingChallenge(m.from as number, (m.name as string) || 'agent'));
    net.on('accept', (m) => { if ((m.from as number) === this.challengeOutTo) this.startPvp('host', m.from as number); });
    net.on('decline', (m) => { if ((m.from as number) === this.challengeOutTo) { this.challengeOutTo = 0; this.toast('Challenge declined'); } });
    net.connect({
      name: decorateName(this.session.short || 'agent'),
      body: getSelectedBody(), tint: tintColor(getSelectedCharacter()),
      x: this.pos.x, z: this.pos.y, facing: this.facing,
    });
  }

  private remoteTex(body: AgentBody, tint: string) {
    return {
      dirTex: {
        down: humanoidTexture(tint, 'front', 0.45, body), up: humanoidTexture(tint, 'back', 0.45, body),
        left: humanoidTexture(tint, 'left', 0.45, body), right: humanoidTexture(tint, 'right', 0.45, body),
      } as Record<Dir, THREE.Texture>,
      walkTex: {
        down: humanoidWalkTexture(tint, 'down', 0.45, body), up: humanoidWalkTexture(tint, 'up', 0.45, body),
        left: humanoidWalkTexture(tint, 'left', 0.45, body), right: humanoidWalkTexture(tint, 'right', 0.45, body),
      } as Record<Dir, THREE.Texture>,
    };
  }

  private makeLabel(text: string): THREE.Sprite {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const x = c.getContext('2d')!;
    x.font = 'bold 30px ui-monospace, monospace';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const w = Math.min(248, x.measureText(text).width + 26);
    x.fillStyle = 'rgba(6,12,22,0.72)';
    x.beginPath(); x.roundRect((256 - w) / 2, 14, w, 36, 9); x.fill();
    x.fillStyle = '#bfe8ff'; x.shadowColor = '#39d0ff'; x.shadowBlur = 8;
    x.fillText(text, 128, 33);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(2.8, 0.7, 1);
    return sp;
  }

  private addPeer(s: PeerState) {
    if (this.peers.has(s.id) || s.id === this.net?.myId) return;
    const body = (s.body as AgentBody) || 'humanoid';
    const { dirTex, walkTex } = this.remoteTex(body, s.tint || '');
    const facing = (s.facing as Dir) || 'down';
    const sprite = this.makeSprite(dirTex[facing], 3.0);
    this.scene.add(sprite);
    const anim = new SpriteAnim(sprite, {
      base: new THREE.Vector3(s.x, 1.35, s.z), scaleW: 3.0, scaleH: 3.0, facing: 1,
      idleTex: dirTex[facing], bob: 0.06, walk: walkTex, walkFrames: WALK_FRAMES, walkFps: 9,
    });
    const label = this.makeLabel(s.name || `agent ${s.id}`);
    this.scene.add(label);
    this.peers.set(s.id, {
      id: s.id, name: s.name, body, tint: s.tint || '', sprite, anim, label,
      cur: new THREE.Vector2(s.x, s.z), target: new THREE.Vector2(s.x, s.z),
      facing, moving: false, running: false, dirTex, walkTex,
    });
    this.updateOnline();
  }

  private onPeerState(s: PeerState) {
    const r = this.peers.get(s.id);
    if (!r) return;
    r.target.set(s.x, s.z);
    r.moving = !!s.moving;
    r.running = !!s.running;
    const f = s.facing as Dir;
    if (f && f !== r.facing) {
      r.facing = f;
      r.anim.setLook(r.dirTex[f], undefined, 3.0, 3.0);
      const mat = r.sprite.material as THREE.SpriteMaterial; mat.map = r.dirTex[f]; mat.needsUpdate = true;
    }
  }

  private reskinPeer(s: { id: number; name: string; body: string; tint: string }) {
    const r = this.peers.get(s.id);
    if (!r) return;
    r.body = (s.body as AgentBody) || 'humanoid'; r.tint = s.tint || ''; r.name = s.name;
    const { dirTex, walkTex } = this.remoteTex(r.body, r.tint);
    r.dirTex = dirTex; r.walkTex = walkTex;
    r.anim.setWalkSheets(walkTex, WALK_FRAMES, 9);
    r.anim.setLook(dirTex[r.facing], undefined, 3.0, 3.0);
    this.scene.remove(r.label);
    r.label = this.makeLabel(s.name); this.scene.add(r.label);
  }

  private removePeer(id: number) {
    const r = this.peers.get(id);
    if (!r) return;
    this.scene.remove(r.sprite); this.scene.remove(r.label);
    this.peers.delete(id);
    this.updateOnline();
  }

  private updateOnline() {
    if (!this.onlineEl) return;
    const n = this.peers.size + 1; // include yourself
    this.onlineEl.innerHTML = `◍ ${n} online`;
  }

  // ---------------- PvP challenge handshake ----------------
  private challengePeer() {
    const p = this.currentPeer;
    if (!p || this.challengeOutTo) return;
    this.challengeOutTo = p.id;
    this.net?.send({ type: 'challenge', to: p.id, name: this.session.short || 'agent' });
    this.toast(`Challenge sent to ${p.name}`);
  }

  private incomingChallenge(from: number, name: string) {
    if (this.challengeEl || this.inPvp) { this.net?.send({ type: 'decline', to: from }); return; }
    const el = document.createElement('div');
    el.id = 'challenge';
    el.style.cssText = 'position:fixed;inset:0;z-index:55;display:flex;align-items:center;justify-content:center;background:rgba(4,8,18,.66)';
    el.innerHTML = `<div class="roster-panel" style="max-width:380px;text-align:center">
      <h2>DUEL REQUEST</h2>
      <div class="sub" style="margin:8px 0 16px"><b>${name}</b> challenges you to a duel.</div>
      <button class="btn" data-act="accept" style="display:block;width:100%;margin:6px 0">Accept · Y</button>
      <button class="btn" data-act="decline" style="display:block;width:100%;margin:6px 0">Decline · N</button>
    </div>`;
    this.container.appendChild(el); this.dom.push(el);
    this.challengeEl = el;
    const close = () => { el.remove(); this.challengeEl = undefined; };
    (el.querySelector('[data-act="accept"]') as HTMLElement).onclick = () => { close(); this.net?.send({ type: 'accept', to: from }); this.startPvp('guest', from); };
    (el.querySelector('[data-act="decline"]') as HTMLElement).onclick = () => { close(); this.net?.send({ type: 'decline', to: from }); };
  }

  private startPvp(role: 'host' | 'guest', oppId: number) {
    const peer = this.peers.get(oppId);
    if (!peer || !this.net || this.inPvp) return;
    this.inPvp = true;
    this.challengeOutTo = 0;
    if (this.challengeEl) { this.challengeEl.remove(); this.challengeEl = undefined; }
    const net = this.extractNet();
    if (!net) return;
    this.opts.onPvp?.({ role, net, oppId, oppName: peer.name, oppBody: peer.body, oppTint: peer.tint });
  }

  // hand the live socket to the battle scene (so it survives dispose())
  private extractNet(): NetClient | undefined {
    const n = this.net;
    n?.clearHandlers();
    this.net = undefined;
    return n;
  }

  private buildPost() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // depth-of-field / tilt-shift: the signature HD-2D look — keeps the player
    // crisp while the near foreground and far field soften (also blurs tiling).
    this.bokeh = new BokehPass(this.scene, this.camera, {
      focus: this.camDist, aperture: 0.00035, maxblur: 0.006,
    });
    this.composer.addPass(this.bokeh);
    this.composer.addPass(new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.55, 0.7,
    ));
    this.composer.addPass(new ShaderPass(GradeShader));
    this.composer.addPass(new OutputPass());
  }

  private makeMotes(): THREE.Points {
    const n = 320;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (Math.random() - 0.5) * 100;
      p[i * 3 + 1] = Math.random() * 16;
      p[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const m = new THREE.PointsMaterial({
      color: 0x8fefff, size: 0.16, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    return new THREE.Points(g, m);
  }

  private addProp(tex: THREE.Texture, x: number, z: number, h: number, storm: boolean, tier: number) {
    const s = this.makeSprite(tex, h);
    const pos = new THREE.Vector2(x, z);
    this.placeSprite(s, pos, h / 2 - 0.2);
    this.scene.add(s);
    this.props.push({ sprite: s, storm, pos, tier });
  }

  private makeSprite(map: THREE.Texture, h: number): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true }));
    s.scale.set(h, h, 1);
    return s;
  }

  private placeSprite(s: THREE.Sprite, pos: THREE.Vector2, y: number) {
    s.position.set(pos.x, y, pos.y);
  }

  private syncPlayer() {
    this.playerAnim?.setBase(this.pos.x, 1.35, this.pos.y);
    this.player.position.set(this.pos.x, 1.35, this.pos.y);
  }

  private updateCamera(snap = false) {
    // spherical offset around the player: pitch = elevation, yaw = orbit angle.
    const horiz = this.camDist * Math.cos(this.camPitch);
    const height = this.camDist * Math.sin(this.camPitch);
    const target = new THREE.Vector3(
      this.pos.x + horiz * Math.sin(this.camYaw),
      height,
      this.pos.y + horiz * Math.cos(this.camYaw),
    );
    if (snap || this.dragging) this.camera.position.copy(target);
    else this.camera.position.lerp(target, 0.15);
    this.camera.lookAt(this.pos.x, 1.2, this.pos.y);
  }

  // --- mouse: wheel = zoom, drag = orbit/pitch ---
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.02, 8, 44);
  };
  private onPointerDown = (e: PointerEvent) => {
    this.dragging = true;
    this.lastX = e.clientX; this.lastY = e.clientY;
  };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX; this.lastY = e.clientY;
    this.camYaw += dx * 0.006;                          // drag sideways to orbit
    this.camPitch = THREE.MathUtils.clamp(this.camPitch - dy * 0.005, 0.28, 1.45); // drag up = look down
  };
  private onPointerUp = () => { this.dragging = false; };

  // ---------------- HUD ----------------
  private buildHUD(session: Session) {
    const tag = document.createElement('div');
    tag.id = 'wallet-tag';
    tag.textContent = `◎ ${session.short} — Sector XR-7`;
    this.container.appendChild(tag); this.dom.push(tag);

    const hint = document.createElement('div');
    hint.id = 'ow-hint';
    hint.innerHTML = `<kbd>WASD</kbd> move &nbsp; <kbd>Shift</kbd> run &nbsp; <kbd>E</kbd> interact &nbsp; <kbd>F</kbd> duel &nbsp; <kbd>C</kbd> agent &nbsp; <kbd>B</kbd> deck &nbsp; <kbd>T</kbd> ops`;
    this.container.appendChild(hint); this.dom.push(hint);

    const credits = document.createElement('div');
    credits.id = 'ow-credits';
    this.container.appendChild(credits); this.dom.push(credits);
    this.creditsEl = credits;
    this.updateCredits();

    // ◊ TIDE balance chip (sits just under Credits)
    const tide = document.createElement('div');
    tide.id = 'ow-tide';
    tide.style.cssText = 'position:fixed;top:88px;left:16px;z-index:30;font:600 14px/1 ui-monospace,monospace;color:#e3ccff;background:rgba(8,14,26,.6);border:1px solid #6b4a8f;border-radius:8px;padding:8px 12px;text-shadow:0 0 8px #b06bff;cursor:pointer';
    tide.title = 'Daily Ops — earn & spend ◊ FLUX (T)';
    tide.onclick = () => this.openOps();
    this.container.appendChild(tide); this.dom.push(tide);
    this.tideEl = tide;
    this.updateTide();

    // settings (sound, install, account)
    const gear = document.createElement('button');
    gear.id = 'ow-settings';
    gear.className = 'btn';
    gear.style.cssText = 'position:fixed;top:124px;left:16px;z-index:12;font-size:14px;padding:7px 12px';
    gear.textContent = '⚙';
    gear.title = 'Settings';
    gear.onclick = () => this.openSettings();
    this.container.appendChild(gear); this.dom.push(gear);

    // data-shard counter
    const shard = document.createElement('div');
    shard.id = 'ow-shards';
    shard.style.cssText = 'position:fixed;top:54px;right:16px;z-index:30;font:600 15px/1 ui-monospace,monospace;color:#bfefff;background:rgba(8,14,26,.6);border:1px solid #2b6;border-color:#2b6f8f;border-radius:8px;padding:7px 11px;text-shadow:0 0 8px #39d0ff';
    this.container.appendChild(shard); this.dom.push(shard);
    this.shardEl = shard;
    this.updateShards();

    // quest objective tracker (shown only while the quest is active)
    const quest = document.createElement('div');
    quest.id = 'ow-quest';
    quest.style.cssText = 'position:fixed;top:96px;right:16px;z-index:30;display:none;min-width:182px;font:600 13px/1.5 ui-monospace,monospace;color:#dfe9ff;background:rgba(8,14,26,.66);border:1px solid #4a78c8;border-radius:8px;padding:9px 12px';
    this.container.appendChild(quest); this.dom.push(quest);
    this.questEl = quest;
    this.updateQuest();

    // multiplayer presence counter
    const online = document.createElement('div');
    online.id = 'ow-online';
    online.style.cssText = 'position:fixed;top:16px;left:16px;z-index:30;font:600 14px/1 ui-monospace,monospace;color:#9effc4;background:rgba(8,20,14,.6);border:1px solid #2b8f5f;border-radius:8px;padding:7px 11px;text-shadow:0 0 8px #39ffae';
    this.container.appendChild(online); this.dom.push(online);
    this.onlineEl = online;
    this.updateOnline();

    // region banner / event toast
    const toast = document.createElement('div');
    toast.id = 'ow-toast';
    toast.style.cssText = 'position:fixed;top:84px;left:50%;transform:translateX(-50%);z-index:40;font:700 18px/1 ui-monospace,monospace;letter-spacing:.06em;color:#fff;background:rgba(10,16,30,.72);border:1px solid #4a78c8;border-radius:10px;padding:10px 18px;opacity:0;transition:opacity .3s;pointer-events:none;text-shadow:0 0 10px #6ab6ff';
    this.container.appendChild(toast); this.dom.push(toast);
    this.toastEl = toast;

    const rosterBtn = document.createElement('button');
    rosterBtn.id = 'ow-roster-btn';
    rosterBtn.className = 'btn';
    rosterBtn.textContent = '◈ AGENTS';
    rosterBtn.onclick = () => this.openRoster();
    this.container.appendChild(rosterBtn); this.dom.push(rosterBtn);

    const deckBtn = document.createElement('button');
    deckBtn.className = 'btn';
    deckBtn.textContent = '⊟ DECK';
    deckBtn.style.cssText = 'position:fixed;top:52px;left:16px;z-index:12;font-size:13px;letter-spacing:.08em;padding:8px 14px';
    deckBtn.onclick = () => this.openDeck();
    this.container.appendChild(deckBtn); this.dom.push(deckBtn);

    this.prompt = document.createElement('div');
    this.prompt.id = 'ow-prompt';
    this.prompt.textContent = 'Press E';
    this.prompt.style.display = 'none';
    this.container.appendChild(this.prompt); this.dom.push(this.prompt);

    this.dialogue = document.createElement('div');
    this.dialogue.id = 'ow-dialogue';
    this.dialogue.style.display = 'none';
    this.container.appendChild(this.dialogue); this.dom.push(this.dialogue);
  }

  private updateCredits() {
    if (this.creditsEl) this.creditsEl.innerHTML = `<span>◈</span> ${getCredits()}`;
  }
  private updateTide() {
    if (this.tideEl) { const cl = getClearance(); this.tideEl.innerHTML = `◊ ${getTide()} <span class="db-dim">· CL${cl.level}</span>`; }
  }
  private updateShards() {
    const got = this.shards.filter((s) => s.taken).length;
    if (this.shardEl) this.shardEl.innerHTML = `◆ ${got} / ${this.shardTotal}`;
  }
  private toast(msg: string) {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = '1';
    this.toastT = 2.4;
  }

  // ---------------- Agent shop (character select + purchase) ----------------
  private toggleRoster() { this.rosterOpen ? this.closeRoster() : this.openRoster(); }

  private openDeck() {
    if (this.deckOpen || this.shopOpen || this.rosterOpen || this.warpOpen || this.talking || !!this.challengeEl) return;
    this.deckOpen = true;
    openDeckBuilder(this.container, () => { this.deckOpen = false; });
  }

  private openShop() {
    if (this.shopOpen || this.deckOpen || this.opsOpen || this.rosterOpen || this.warpOpen || this.talking || !!this.challengeEl) return;
    this.shopOpen = true;
    openChipShop(this.container, () => { this.shopOpen = false; this.updateCredits(); });
  }

  private openOps() {
    if (this.opsOpen || this.shopOpen || this.deckOpen || this.settingsOpen || this.rosterOpen || this.warpOpen || this.talking || !!this.challengeEl) return;
    this.opsOpen = true;
    openOps(this.container, () => { this.opsOpen = false; this.updateTide(); this.broadcastCosmetics(); });
  }

  private openSettings() {
    if (this.settingsOpen || this.opsOpen || this.shopOpen || this.deckOpen || this.rosterOpen || this.warpOpen || this.talking || !!this.challengeEl) return;
    this.settingsOpen = true;
    openSettings(this.container, this.session, () => { this.settingsOpen = false; });
  }

  // re-send presence with the freshly-equipped badge so peers see the flex
  private broadcastCosmetics() {
    this.net?.reskin({ name: decorateName(this.session.short || 'agent'), body: getSelectedBody(), tint: tintColor(getSelectedCharacter()) });
  }

  private openRoster() {
    if (this.rosterOpen) return;
    this.rosterOpen = true;
    const el = document.createElement('div');
    el.id = 'roster';
    this.container.appendChild(el); this.dom.push(el);
    this.rosterEl = el;

    const render = () => {
      const cur = getSelectedCharacter().id;
      const credits = getCredits();
      const curBody = getSelectedBody();
      el.innerHTML = `
        <div class="roster-panel">
          <h2>AGENT SHOP</h2>
          <div class="sub">Pick a chassis &amp; shell · switch owned ones free · win battles to earn <b>◈ Credits</b></div>
          <div class="roster-wallet">◈ ${credits}</div>
          <div class="body-row"></div>
          <div class="roster-grid"></div>
          <button class="btn" data-act="close">Close · Esc</button>
        </div>`;

      // --- chassis (body archetype) selector ---
      const bodyRow = el.querySelector('.body-row') as HTMLElement;
      for (const b of BODIES) {
        const on = b.id === curBody;
        const chip = document.createElement('div');
        chip.className = 'bodychip' + (on ? ' selected' : '');
        const art = humanoidCanvas(tintColor(getSelectedCharacter()), 'front', 0.45, b.id);
        art.className = 'bodyart';
        chip.appendChild(art);
        const lab = document.createElement('div');
        lab.className = 'bodymeta';
        lab.innerHTML = `<div class="bname">${b.name}</div><div class="bdesc">${b.desc}</div>`;
        chip.appendChild(lab);
        chip.onclick = () => { this.pickBody(b.id); render(); };
        bodyRow.appendChild(chip);
      }

      const grid = el.querySelector('.roster-grid') as HTMLElement;
      for (const ch of CHARACTERS) {
        const owned = isOwned(ch.id);
        const equipped = ch.id === cur;
        const afford = credits >= ch.cost;
        const card = document.createElement('div');
        card.className = 'agentcard' + (equipped ? ' selected' : '') + (!owned && !afford ? ' locked' : '');
        const art = humanoidCanvas(tintColor(ch), 'front', 0.45, curBody);
        art.className = 'agentart';
        card.appendChild(art);
        const status = equipped ? '✓ EQUIPPED'
          : owned ? 'Equip'
          : afford ? `Buy · ◈ ${ch.cost}`
          : `◈ ${ch.cost} (locked)`;
        const meta = document.createElement('div');
        meta.className = 'agentmeta';
        meta.innerHTML = `<div class="aname">${ch.name}</div><div class="adesc">${ch.desc}</div>` +
          `<div class="apick">${status}</div>`;
        card.appendChild(meta);
        card.onclick = () => { this.pickCharacter(ch.id); render(); this.updateCredits(); };
        grid.appendChild(card);
      }
      (el.querySelector('[data-act="close"]') as HTMLElement).onclick = () => this.closeRoster();
    };
    render();
  }

  private closeRoster() {
    this.rosterOpen = false;
    if (this.rosterEl) { this.rosterEl.remove(); this.rosterEl = undefined; }
  }

  // build the 4 directional idle + walk-strip textures for a character (tint + body)
  private setCharacterTextures(tint: string) {
    const body = getSelectedBody();
    this.dirTex = {
      down: humanoidTexture(tint, 'front', 0.45, body),
      up: humanoidTexture(tint, 'back', 0.45, body),
      left: humanoidTexture(tint, 'left', 0.45, body),
      right: humanoidTexture(tint, 'right', 0.45, body),
    };
    this.walkTex = {
      down: humanoidWalkTexture(tint, 'down', 0.45, body),
      up: humanoidWalkTexture(tint, 'up', 0.45, body),
      left: humanoidWalkTexture(tint, 'left', 0.45, body),
      right: humanoidWalkTexture(tint, 'right', 0.45, body),
    };
    this.playerAnim?.setWalkSheets(this.walkTex, WALK_FRAMES, 9);
  }

  // point the player sprite at its current facing direction's view
  private faceDir(dir: Dir) {
    this.facing = dir;
    const tex = this.dirTex[dir];
    this.playerAnim.setLook(tex, undefined, 3.0, 3.0);
    const mat = this.player.material as THREE.SpriteMaterial;
    mat.map = tex; mat.needsUpdate = true;
  }

  // buy if needed (no-op if unaffordable), then equip if owned.
  private pickCharacter(id: string) {
    if (!isOwned(id) && !buyCharacter(id)) return; // can't afford → bail
    setSelectedCharacter(id);
    const ch = characterById(id);
    this.setCharacterTextures(tintColor(ch));
    this.faceDir(this.facing);
    this.broadcastSkin();
  }

  // switch the body archetype (chassis) — free, applies the current tint live.
  private pickBody(id: AgentBody) {
    setSelectedBody(id);
    this.setCharacterTextures(tintColor(getSelectedCharacter()));
    this.faceDir(this.facing);
    this.broadcastSkin();
  }

  // tell other players our new look
  private broadcastSkin() {
    this.net?.reskin({ name: this.session.short || 'agent', body: getSelectedBody(), tint: tintColor(getSelectedCharacter()) });
  }

  // ---------------- dialogue ----------------
  private startDialogue(lines: string[]) {
    this.talking = true;
    this.dialogueLines = lines;
    this.lineIdx = 0;
    this.dialogue.style.display = 'block';
    this.dialogue.textContent = lines[0];
  }
  private advanceDialogue() {
    this.lineIdx++;
    if (this.lineIdx >= this.dialogueLines.length) this.endDialogue();
    else this.dialogue.textContent = this.dialogueLines[this.lineIdx];
  }
  private endDialogue() {
    this.talking = false;
    this.dialogue.style.display = 'none';
  }

  // ---------------- Input ----------------
  private gameKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyE']);
  private onKeyDown = (e: KeyboardEvent) => {
    if (this.gameKeys.has(e.code)) e.preventDefault();
    if (this.keys[e.code]) return;
    this.keys[e.code] = true; this.fresh.push(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys[e.code] = false; };

  // nearest interactable within its radius, or null
  private updateActorFocus() {
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const a of this.actors) {
      const d = this.pos.distanceTo(a.pos);
      if (d < a.radius && d < bestD) { bestD = d; best = a; }
    }
    this.currentActor = best;
  }

  private currentStorm(): Prop | null {
    return this.props.find((p) => p.storm && this.pos.distanceTo(p.pos) < 2.6) ?? null;
  }

  // nearest remote player within challenge range
  private updatePeerFocus() {
    let best: Remote | null = null; let bd = Infinity;
    for (const r of this.peers.values()) {
      const d = this.pos.distanceTo(r.cur);
      if (d < 3.0 && d < bd) { bd = d; best = r; }
    }
    this.currentPeer = best;
  }

  // ---------------- Loop ----------------
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    this.grace = Math.max(0, this.grace - dt);

    this.discoverBeaconsNear();
    this.updateActorFocus();
    this.updatePeerFocus();
    for (const code of this.fresh) {
      if (this.deckOpen || this.shopOpen || this.opsOpen || this.settingsOpen) break; // an open modal owns input
      if (code === 'KeyB') this.openDeck();
      else if (code === 'KeyT') this.openOps();
      else if (code === 'KeyC') this.toggleRoster();
      else if (code === 'Escape') {
        if (this.rosterOpen) this.closeRoster();
        else if (this.warpOpen) this.closeWarp();
        else if (this.challengeEl) (this.challengeEl.querySelector('[data-act="decline"]') as HTMLElement)?.click();
        else if (this.talking) this.endDialogue();
      } else if (this.challengeEl) {
        if (code === 'KeyY') (this.challengeEl.querySelector('[data-act="accept"]') as HTMLElement)?.click();
        else if (code === 'KeyN') (this.challengeEl.querySelector('[data-act="decline"]') as HTMLElement)?.click();
      } else if (code === 'KeyE') {
        if (this.talking) this.advanceDialogue();
        else if (!this.rosterOpen && !this.warpOpen && this.currentActor) this.currentActor.action();
      } else if (code === 'KeyF') {
        if (!this.rosterOpen && !this.warpOpen && !this.talking) this.challengePeer();
      }
    }
    this.fresh = [];

    // autosave position so battles & tab reloads resume where you stood
    this.saveT += dt;
    if (this.saveT > 1) { this.saveT = 0; savePos(this.pos.x, this.pos.y); }

    let dir: Dir | null = null;
    let running = false;
    if (!this.talking && !this.done && !this.rosterOpen && !this.warpOpen && !this.challengeEl && !this.deckOpen && !this.shopOpen && !this.opsOpen && !this.settingsOpen) {
      let dx = 0, dz = 0;
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) dx -= 1;
      if (this.keys['KeyD'] || this.keys['ArrowRight']) dx += 1;
      if (this.keys['KeyW'] || this.keys['ArrowUp']) dz -= 1;
      if (this.keys['KeyS'] || this.keys['ArrowDown']) dz += 1;
      const moving = dx !== 0 || dz !== 0;
      running = moving && !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']);
      if (moving) {
        const spd = SPEED * (running ? RUN_MULT : 1);
        const len = Math.hypot(dx, dz);
        this.pos.x = THREE.MathUtils.clamp(this.pos.x + (dx / len) * spd * dt, -BOUNDS.x, BOUNDS.x);
        this.pos.y = THREE.MathUtils.clamp(this.pos.y + (dz / len) * spd * dt, -BOUNDS.z, BOUNDS.z);
        dir = Math.abs(dx) >= Math.abs(dz) ? (dx < 0 ? 'left' : 'right') : (dz < 0 ? 'up' : 'down');
        if (dir !== this.facing) this.faceDir(dir); // turn to face where we walk
        this.checkRegion();
        this.collectShards();
        if (this.grace <= 0) {
          const storm = this.currentStorm();
          this.encMeter += dt * (storm ? 2.5 : 0.1);
          if (this.encMeter > 1 && Math.random() < dt * 4) {
            const tier = storm ? storm.tier : Math.max(0, this.regionIdx);
            this.triggerEncounter(tier);
          }
        }
      }
    }

    // interaction prompt (actors take priority; else offer a duel to a nearby player)
    if (this.deckOpen || this.shopOpen || this.opsOpen || this.settingsOpen) {
      this.prompt.style.display = 'none';
    } else if (!this.talking && !this.rosterOpen && !this.warpOpen && !this.challengeEl && this.currentActor) {
      this.prompt.textContent = `E · ${this.currentActor.prompt()}`;
      this.prompt.style.display = 'block';
    } else if (!this.talking && !this.rosterOpen && !this.warpOpen && !this.challengeEl && this.currentPeer && !this.challengeOutTo) {
      this.prompt.textContent = `F · Challenge ${this.currentPeer.name}`;
      this.prompt.style.display = 'block';
    } else {
      this.prompt.style.display = 'none';
    }

    // toast fade
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0 && this.toastEl) this.toastEl.style.opacity = '0';
    }

    // player walk/idle animation
    this.playerAnim.setMove(dir, running);
    this.playerAnim.setBase(this.pos.x, 1.35, this.pos.y);
    this.playerAnim.update(dt);

    // multiplayer: stream my state, advance & interpolate remote players
    if (this.net) {
      this.net.sendState(
        { x: this.pos.x, z: this.pos.y, facing: this.facing, moving: dir !== null, running },
        performance.now(),
      );
      for (const r of this.peers.values()) {
        r.cur.lerp(r.target, Math.min(1, dt * 10));
        r.anim.setMove(r.moving ? r.facing : null, r.running);
        r.anim.setBase(r.cur.x, 1.35, r.cur.y);
        r.anim.update(dt);
        r.label.position.set(r.cur.x, 3.15 + Math.sin(t * 1.6) * 0.05, r.cur.y);
      }
    }

    // actor + shard idle bob/spin
    for (const a of this.actors) a.sprite.position.y = a.baseY + Math.sin(t * 1.6 + a.phase) * a.bob;
    for (const s of this.shards) {
      if (s.taken) continue;
      s.sprite.position.y = s.baseY + Math.sin(t * 2.4 + s.pos.x) * 0.18;
    }

    // drift the motes upward, wrapping at the top
    const arr = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < arr.count; i++) {
      let y = arr.getY(i) + dt * 0.6;
      if (y > 16) y = 0;
      arr.setY(i, y);
    }
    arr.needsUpdate = true;
    this.motes.position.set(this.pos.x, 0, this.pos.y); // keep field around the player

    this.updateCamera();
    // keep depth-of-field focused on the player as you zoom/move
    const bk = this.bokeh.uniforms as Record<string, { value: number }>;
    bk['focus'].value = this.camera.position.distanceTo(new THREE.Vector3(this.pos.x, 1.2, this.pos.y));
    this.composer.render();
  };

  private checkRegion() {
    const idx = Math.max(0, regionAt(this.pos.x, this.pos.y));
    if (idx !== this.regionIdx) {
      this.regionIdx = idx;
      this.toast(`◈ ${REGIONS[idx].name}`);
    }
  }

  private collectShards() {
    this.shards.forEach((s, i) => {
      if (s.taken) return;
      if (this.pos.distanceTo(s.pos) < 1.7) {
        s.taken = true;
        s.sprite.visible = false;
        collectShard(i);
        addCredits(15);
        this.updateCredits();
        this.updateShards();
        this.updateQuest();
        const got = this.shards.filter((x) => x.taken).length;
        if (got >= this.shardTotal) this.toast('ALL SHARDS RECOVERED · talk to the Oracle');
        else this.toast(`Data-shard ${got}/${this.shardTotal} · +◈ 15`);
      }
    });
  }

  private triggerEncounter(tier: number) {
    this.encMeter = 0;
    this.done = true;
    savePos(this.pos.x, this.pos.y); // resume here after the fight
    const pool = REGIONS[Math.min(tier, REGIONS.length - 1)].enemies.filter((i) => i < ENEMY_COUNT);
    const idx = pool.length ? pool[Math.floor(Math.random() * pool.length)] : Math.floor(Math.random() * ENEMY_COUNT);
    const flash = document.createElement('div');
    flash.style.cssText = 'position:fixed;inset:0;background:#bff6ff;opacity:0;z-index:60;transition:opacity .35s;pointer-events:none';
    this.container.appendChild(flash);
    requestAnimationFrame(() => { flash.style.opacity = '1'; });
    setTimeout(() => { flash.remove(); this.opts.onEncounter(idx); }, 380);
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.net?.dispose();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('wheel', this.onWheel);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    for (const el of this.dom) el.remove();
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }
}
