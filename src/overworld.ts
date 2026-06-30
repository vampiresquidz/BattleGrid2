import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

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

// NEON-9 light rain + occasional lightning, as a cheap screen-space overlay.
const RainShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, flash: { value: 0 }, intensity: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float flash; uniform float intensity; varying vec2 vUv;
    float h(float x){ return fract(sin(x*91.345)*43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 uv = vUv; uv.x += uv.y * 0.16;            // slanted rain
      float N = 150.0;
      float col = floor(uv.x * N);
      float spd = 0.8 + h(col) * 1.6;
      float t = fract(uv.y * 6.0 + time * spd + h(col + 7.0));
      float drop = smoothstep(0.0, 0.04, t) * smoothstep(0.55, 0.0, t);     // falling dash
      float xl = smoothstep(0.82, 1.0, 1.0 - abs(fract(uv.x * N) - 0.5) * 2.0);
      c.rgb += drop * xl * (0.4 + 0.6 * h(col + 3.0)) * vec3(0.5, 0.66, 0.82) * 0.22 * intensity;
      c.rgb += flash * vec3(0.22, 0.42, 0.6);        // cyan lightning lift
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

const BOUNDS = { x: 40, z: 27 };  // expanded play area (large data-continent)
const SPEED = 6.4;
const RUN_MULT = 1.75;   // Shift = run
const PLAYER_R = 0.6;    // collision radius vs. shop buildings
type Dir = 'down' | 'up' | 'left' | 'right';

// Three concentric difficulty regions (by distance from the spawn core). The
// farther out you roam, the nastier the processes — and the richer the loot.
const REGIONS = [
  { name: 'INNER FLATS', maxR: 19, enemies: [0, 1, 2] },
  { name: 'OUTER GRID',  maxR: 35, enemies: [3, 4, 5] },
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
  onPortal?: (theme: 'net' | 'rat') => void;   // step into a roguelike dungeon portal
}

// HD-2D alien digital planet: free-roam a large glowing data-continent split into
// escalating sectors, chat with the resident processes, crack data-caches for
// Credits, hunt scattered data-shards, and stir up battles in the data-storms.
// 2D pixel sprites in a 3D diorama with bloom + fog, Octopath-Traveler style.
export class OverworldScene {
  private renderer: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private bokeh!: BokehPass;
  private rainPass!: ShaderPass;
  private flashT = 0;
  private searchlights: THREE.Mesh[] = [];
  private nexus?: THREE.Object3D;
  // weather: rain rolls in and clears off on a slow cycle (0 = dry, 1 = downpour)
  private weather = 1;
  private weatherTarget = 1;
  private weatherT = 16;
  private topMat?: THREE.MeshStandardMaterial;                 // wet-asphalt ground (sheen tracks weather)
  private neonLights: Array<{ l: THREE.PointLight; base: number; ph: number }> = []; // flickering signage
  private traffic: Array<{ mesh: THREE.Mesh; speed: number; len: number }> = [];      // highway light streaks
  private mist: THREE.Sprite[] = [];                            // drifting low ground haze
  private roadRects: Array<{ x: number; z: number; rx: number; rz: number }> = [];     // ground-road footprints
  private buildingRects: Array<{ x: number; z: number; rx: number; rz: number }> = []; // shop/tower footprints
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;

  private player!: THREE.Sprite;
  private playerAnim!: SpriteAnim;
  private pos = new THREE.Vector2(0, 6);
  private props: Prop[] = [];
  private actors: Interactable[] = [];
  // physical shop buildings: collision footprints + the placed structures (so a
  // late-loading 3D model can replace the procedural body in-place).
  private obstacles: Array<{ x: number; z: number; rx: number; rz: number }> = [];
  private buildings: Array<{ group: THREE.Group; body: THREE.Object3D; accent: number }> = [];
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
    // NEON-9: a rain-slick cyberpunk megacity at perpetual night. Smog haze + a
    // dark wet-asphalt slab; neon point-lights + bloom carry the colour.
    this.scene.fog = new THREE.Fog(0x14161f, 70, 210);
    this.scene.background = new THREE.Color(0x0d0f16); // smog night sky

    // the city block sits on a wet-asphalt SLAB; cliff edges = concrete/metal.
    const top = textures.alienGround();
    top.wrapS = top.wrapT = THREE.RepeatWrapping; top.repeat.set(13, 9);
    const cliff = textures.alienCliff();
    cliff.repeat.set(18, 1);
    const topMat = new THREE.MeshStandardMaterial({
      map: top, emissiveMap: top, emissive: 0x16283f, emissiveIntensity: 0.4,
      color: 0x232838, roughness: 0.5, metalness: 0.35, // wet sheen reflecting neon, but ground still reads
    });
    this.topMat = topMat;
    const cliffMat = new THREE.MeshStandardMaterial({
      map: cliff, emissiveMap: cliff, emissive: 0x4a2a8f, emissiveIntensity: 0.35,
      color: 0x2a2d38, roughness: 0.8, metalness: 0.3,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 1 });
    // BoxGeometry face order: [+x, -x, +y(top), -y(bottom), +z, -z]
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(88, 6, 62),
      [cliffMat, cliffMat, topMat, darkMat, cliffMat, cliffMat],
    );
    slab.position.y = -3; // top surface sits at y = 0 where sprites stand
    slab.receiveShadow = true;
    this.scene.add(slab);

    // lighting — very low cold ambient (night) + dim moonlight, then strong NEON
    // pools (pink/cyan/violet/amber) that bloom and reflect off the wet road.
    this.scene.add(new THREE.AmbientLight(0x1c2236, 0.95));
    const sun = new THREE.DirectionalLight(0x7a88aa, 0.32); // cold moonlight
    sun.position.set(-6, 16, 8);
    this.scene.add(sun);
    const accents: Array<[number, number, number, number, number]> = [
      [0x16e0ff, 5, 6, 5, 52],     // neon cyan core
      [0xff2d95, -8, 6, -3, 48],   // neon pink core
      [0xffb020, 0, 5, 9, 44],     // amber warning glow
      [0x16e0ff, 28, 7, -14, 62],  // far cyan
      [0xff2d95, -30, 7, 13, 62],  // far pink
      [0x9b5cff, -26, 7, -16, 60], // far violet
      [0xff2d95, 26, 6, 16, 54],   // far pink 2
      [0x9b5cff, 14, 6, -22, 50],  // violet
      [0xaaff36, -16, 6, 22, 46],  // toxic lime accent
    ];
    for (const [c, x, y, z, r] of accents) {
      const l = new THREE.PointLight(c, 22, r);
      l.position.set(x, y, z);
      this.scene.add(l);
      this.neonLights.push({ l, base: 22, ph: Math.random() * 6.28 }); // subtle cyberpunk flicker
    }

    // street furniture — neon street lamps + glowing bollards (was crystals)
    const lampSpots: Array<[number, number]> = [
      [12, -6], [-14, 6], [19, -8], [26, 14], [-27, -8], [31, 4],
      [-33, 16], [14, 22], [-12, -18], [35, -12], [-36, 2], [22, -18],
      [-20, 20], [33, 18], [-30, -18], [8, -22],
    ];
    for (const [x, z] of lampSpots) this.addProp(textures.citylamp(), x, z, 3.2, false, 0);
    // tall holographic billboards / neon sign towers (was spires)
    const signSpots: Array<[number, number]> = [
      [16, 5], [-20, -5], [28, -3], [-28, 11], [21, 19], [-24, -17],
      [36, 15], [-37, -3], [18, -16], [-16, 17],
    ];
    for (const [x, z] of signSpots) this.addProp(textures.citysign(), x, z, 4.6, false, 0);
    // grime: dumpsters / AC condensers + steam vents
    const dumpSpots: Array<[number, number]> = [[10, 9], [-9, -14], [24, -2], [-30, 9], [17, -24]];
    for (const [x, z] of dumpSpots) this.addProp(textures.dumpster(), x, z, 2.6, false, 0);
    const ventSpots: Array<[number, number]> = [[-6, 8], [13, -2], [-18, -3], [29, 8], [-13, 13]];
    for (const [x, z] of ventSpots) this.addProp(textures.vent(), x, z, 1.9, false, 0);
    // data-storms (battle zones) → sparking broken terminals / dead android husks
    const stormSpots: Array<[number, number]> = [
      [6, 4], [-11, -8], [2, -4],                          // slums
      [20, -9], [-21, -11], [24, 13], [-18, 17],           // corpo core
      [34, -20], [-35, 6], [27, 22], [-34, -22], [16, 24], // the wires
    ];
    for (const [x, z] of stormSpots) {
      this.addProp(textures.terminal(), x, z, 3.0, true, Math.max(0, regionAt(x, z)));
    }

    // searchlights — bright soft pools sweeping the wet street (from blimps above)
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(7, 32),
        new THREE.MeshBasicMaterial({ map: orbTexture('#ffffff', '#cfe6ff'), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      m.rotation.x = -Math.PI / 2; m.position.y = 0.06;
      this.scene.add(m); this.searchlights.push(m);
    }

    // sky: a hazy moon + faint star wash for depth above the smog
    this.buildSky();

    // streets: a neon-lined road grid + elevated background highways
    this.buildRoads();

    // low drifting ground haze (volumetric feel, catches the neon)
    this.buildMist();

    // the megacity itself: a neon skyline ring + landmark towers + The Nexus
    this.buildCity();

    // physical shop buildings (a marketplace plaza near spawn)
    this.buildShops();

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

    this.validateRoads();

    this.syncPlayer();
    this.updateCamera(true);
  }

  // dev guard: warn if any shop/tower footprint overlaps a road strip (so the
  // "buildings off the roads" invariant can't silently regress).
  private validateRoads() {
    if (!new URLSearchParams(location.search).has('dev')) return;
    let hits = 0;
    for (const b of this.buildingRects)
      for (const r of this.roadRects)
        if (Math.abs(b.x - r.x) < b.rx + r.rx - 0.05 && Math.abs(b.z - r.z) < b.rz + r.rz - 0.05) {
          hits++;
          console.warn(`[roads] building @(${b.x},${b.z}) sits on road @(${r.x},${r.z})`);
        }
    console.log(`[roads] ${this.roadRects.length} roads, ${this.buildingRects.length} buildings, ${hits} overlaps`);
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
    // The Fixer — a job-broker droid that gives & tracks the "Lost Index" quest.
    const oracle = this.makeSprite(textures.fixerbot(), 2.8);
    this.addActor(oracle, -6, 6, 1.4, 2.8,
      () => (getQuestStage() === 0 ? 'Talk to the Oracle ·  !'
        : getQuestStage() === 1 && this.questComplete() ? 'Claim · The Lost Index'
        : 'Talk to the Oracle'),
      () => this.talkOracle(), 0.06);

    // The Archivist — a vendor-droid that hands out lore + shard hints.
    const arch = this.makeSprite(textures.vendordroid(), 3.0);
    this.addActor(arch, 6, 6, 1.5, 2.8,
      () => 'Talk to the Archivist',
      () => this.startDialogue([
        'Archivist: "Fragments of a deleted index drift across the sectors."',
        `"Recover all ${this.shardTotal} data-shards and the cache they unlock is... generous."`,
        '"The outer grid and deep sectors hide the rest. Mind the storms."',
      ]));

    // The Net Dungeon Portal — a swirling rift into a freshly generated maze.
    const portal = this.makeSprite(orbTexture('#ffd6ff', '#b03aff'), 3.6);
    this.addActor(portal, 0, -14, 2.1, 3.0,    // a rift in the south avenue out of the roundabout
      () => 'Enter the GRID DUNGEON ·  ▣',
      () => this.opts.onPortal?.('net'), 0.22);

    // The Warrens — a cave mouth in the NW corner into the rat-infested dungeon.
    this.makeCavePortal(-34, -22);

    // Data caches — crack for Credits (once, persisted). Reward scales with depth.
    const cacheSpots: Array<[number, number]> = [
      [18, 12], [-24, 9], [30, -14], [-34, -16], [33, 20], [-20, 22], [26, -22],
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

  // ---------------- the megacity (skyline + towers + Nexus) ----------------
  // A dark facade with a grid of lit neon windows — emissive so the windows
  // bloom. Cached + reused across every tower.
  private neonWindowsTexture(): THREE.Texture {
    const w = 128, h = 256;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#0a0c14'; g.fillRect(0, 0, w, h);
    const tints = ['#16e0ff', '#ff2d95', '#ffb020', '#9b5cff', '#cfe6ff'];
    const cw = 12, ch = 16, pad = 5;
    for (let y = 8; y < h - 8; y += ch) {
      for (let x = 8; x < w - 8; x += cw) {
        if (Math.random() < 0.42) {
          g.fillStyle = tints[(Math.random() * tints.length) | 0];
          g.globalAlpha = 0.5 + Math.random() * 0.5;
          g.fillRect(x, y, cw - pad, ch - pad);
        }
      }
    }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  private makeTower(w: number, ht: number, d: number, tex: THREE.Texture): THREE.Mesh {
    const m = tex.clone(); m.needsUpdate = true; m.repeat.set(Math.max(1, Math.round(w / 4)), Math.max(2, Math.round(ht / 6)));
    const side = new THREE.MeshStandardMaterial({ map: m, emissiveMap: m, emissive: 0xffffff, emissiveIntensity: 0.6, color: 0x12151f, roughness: 0.7, metalness: 0.4 });
    const cap = new THREE.MeshStandardMaterial({ color: 0x0a0c12, roughness: 1 });
    // box faces: [+x,-x,+y,-y,+z,-z]
    return new THREE.Mesh(new THREE.BoxGeometry(w, ht, d), [side, side, cap, cap, side, side]);
  }

  private buildCity() {
    const tex = this.neonWindowsTexture();

    // far skyline ring — a dense megacity silhouette around the play area; out of
    // reach (no collision), bases sunk so they rise from the smog, fog-faded.
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + Math.random() * 0.18;
      const r = 50 + Math.random() * 26;
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.78;
      const ht = 14 + Math.random() * 30;
      const w = 5 + Math.random() * 7, d = 5 + Math.random() * 7;
      const t = this.makeTower(w, ht, d, tex);
      t.position.set(x, ht / 2 - 5, z);
      t.rotation.y = Math.random() * 0.6 - 0.3;
      this.scene.add(t);
    }

    // in-map landmark towers (corpo blocks) — solid, so you weave between them.
    // Each sits in a block interior (between road lines), so roads pass around
    // them, never under them.
    const blocks: Array<[number, number, number, number]> = [ // x, z, w, height
      [7.5, -18, 6, 16], [-22.5, -6, 6, 18], [22.5, -6, 6, 14], [-7.5, 18, 6, 15], [22.5, 18, 7, 20],
    ];
    for (const [x, z, w, ht] of blocks) {
      const t = this.makeTower(w, ht, w, tex);
      t.position.set(x, ht / 2, z);
      this.scene.add(t);
      this.obstacles.push({ x, z, rx: w / 2, rz: w / 2 });
      this.buildingRects.push({ x, z, rx: w / 2, rz: w / 2 });
    }

    // THE NEXUS — a neon data-fountain landmark in the central plaza.
    const nexus = new THREE.Group(); nexus.position.set(0, 0, 0);
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.9, 5.5, 12),
      new THREE.MeshStandardMaterial({ color: 0x0c1830, emissive: 0x16e0ff, emissiveIntensity: 1.4, roughness: 0.4 }),
    );
    core.position.y = 2.75; nexus.add(core);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.3 - i * 0.25, 0.08, 8, 28),
        new THREE.MeshStandardMaterial({ color: 0x0c1830, emissive: i % 2 ? 0xff2d95 : 0x16e0ff, emissiveIntensity: 1.2 }),
      );
      ring.rotation.x = Math.PI / 2 + (i - 1) * 0.2; ring.position.y = 1.4 + i * 1.4; nexus.add(ring);
    }
    const np = new THREE.PointLight(0x16e0ff, 26, 26); np.position.set(0, 4, 0); nexus.add(np);
    this.scene.add(nexus); this.nexus = nexus;
    this.obstacles.push({ x: 0, z: 0, rx: 1.3, rz: 1.3 });
  }

  // ---------------- sky: moon + stars ----------------
  private buildSky() {
    // a faint star wash on a far dome (fog dims the lower ones → depth)
    const n = 380;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = 0.12 + Math.random() * 1.2;            // mostly upper hemisphere
      const r = 150;
      p[i * 3] = Math.cos(a) * Math.cos(el) * r;
      p[i * 3 + 1] = Math.sin(el) * r * 0.8 + 18;
      p[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xbfe6ff, size: 0.9, sizeAttenuation: true, transparent: true,
      opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.scene.add(stars);

    // a big hazy moon low over the skyline — bloom turns it into a soft glow
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: orbTexture('#f4faff', '#7fa8d8'), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
    }));
    moon.scale.set(34, 34, 1);
    moon.position.set(58, 60, -135);
    this.scene.add(moon);
  }

  // ---------------- low ground haze ----------------
  private buildMist() {
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: orbTexture('#3a4a66', '#0a0e18'), transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      const sc = 30 + Math.random() * 26;
      s.scale.set(sc, sc * 0.5, 1);
      s.position.set((Math.random() - 0.5) * 76, 1.2 + Math.random() * 1.6, (Math.random() - 0.5) * 52);
      this.scene.add(s);
      this.mist.push(s);
    }
  }

  // ---------------- streets: road grid + elevated highways ----------------
  // Wet asphalt with glowing neon lane markings (cyan edges + amber centre
  // dashes). Dark base, bright lines → the lines bloom. Tiles along its length.
  private roadTexture(): THREE.Texture {
    const w = 64, h = 128;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#0f1118'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { // faint asphalt mottle
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.22)';
      g.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 2, 2);
    }
    g.fillStyle = '#16e0ff';                                  // glowing cyan edge lines
    g.fillRect(5, 0, 3, h); g.fillRect(w - 8, 0, 3, h);
    g.fillStyle = '#ffc23a';                                  // amber centre dashes
    for (let y = 0; y < h; y += 30) g.fillRect(w / 2 - 2, y, 4, 16);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  private addRoad(base: THREE.Texture, cx: number, cz: number, length: number, width: number, angleY = 0, y = 0.05) {
    const tex = base.clone(); tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, Math.max(1, Math.round(length / 8)));
    const mat = new THREE.MeshStandardMaterial({
      map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.7,
      color: 0x171a22, roughness: 0.42, metalness: 0.5,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, length), mat);
    plane.rotation.x = -Math.PI / 2;
    const grp = new THREE.Group();
    grp.position.set(cx, y, cz); grp.rotation.y = angleY; grp.add(plane);
    this.scene.add(grp);
    // record the axis-aligned footprint so we can verify nothing sits on it
    const along = Math.abs(((angleY % Math.PI) + Math.PI) % Math.PI) < 0.01; // length runs along z
    this.roadRects.push({ x: cx, z: cz, rx: along ? width / 2 : length / 2, rz: along ? length / 2 : width / 2 });
  }

  // An elevated neon highway: a dark deck on pillars with glowing guard-rails and
  // streaking traffic lights, sweeping across the far skyline (outside play bounds).
  private addHighway(cx: number, cz: number, length: number, angleY: number, y: number) {
    const grp = new THREE.Group(); grp.position.set(cx, y, cz); grp.rotation.y = angleY;
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(6, 0.5, length),
      new THREE.MeshStandardMaterial({ color: 0x0d0f16, roughness: 0.8, metalness: 0.4 }),
    );
    grp.add(deck);
    const rail = (xoff: number, col: number) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 0.5, length),
        new THREE.MeshStandardMaterial({ color: 0x0c1018, emissive: col, emissiveIntensity: 1.1 }),
      );
      m.position.set(xoff, 0.4, 0); grp.add(m);
    };
    rail(3, 0x16e0ff); rail(-3, 0xff2d95);
    const under = new THREE.Mesh(                                   // amber underglow strip
      new THREE.BoxGeometry(5, 0.12, length),
      new THREE.MeshStandardMaterial({ color: 0x110a02, emissive: 0xffb020, emissiveIntensity: 0.7 }),
    );
    under.position.y = -0.32; grp.add(under);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x0a0c12, roughness: 1 });
    for (let d = -length / 2 + 6; d <= length / 2 - 6; d += 14) {   // support pillars
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, y, 1.2), pillarMat);
      p.position.set(0, -y / 2 - 0.25, d); grp.add(p);
    }
    // streaking traffic — headlights (white, +z) and taillights (red, -z)
    const car = (xoff: number, col: number, dirSign: number) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.18, 1.4),
        new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.6 }),
      );
      m.position.set(xoff, 0.34, (Math.random() - 0.5) * length);
      grp.add(m);
      this.traffic.push({ mesh: m, speed: dirSign * (10 + Math.random() * 12), len: length });
    };
    for (let i = 0; i < 3; i++) { car(1.6, 0xfff2d0, 1); car(-1.6, 0xff3344, -1); }
    this.scene.add(grp);
  }

  private buildRoads() {
    const base = this.roadTexture();
    // Outer grid routed through the GAPS between building blocks (avenues run
    // N–S at x=±15,±30; cross streets run E–W at z=±12,±24). Every shop & tower
    // sits in a block interior and fronts one of these — none sits on a road.
    for (const x of [-30, -15, 15, 30]) this.addRoad(base, x, 0, 52, 4.4, 0, 0.05);
    for (const z of [-24, -12, 12, 24]) this.addRoad(base, 0, z, 68, 4.4, Math.PI / 2, 0.06);
    // four spokes feeding the central roundabout (the x=0 / z=0 lines, split so
    // they meet the ring instead of crossing the Nexus island)
    this.addRoad(base, 0, 17, 18, 4.4, 0, 0.055);            // N spoke  z[8,26]
    this.addRoad(base, 0, -17, 18, 4.4, 0, 0.055);           // S spoke  z[-26,-8]
    this.addRoad(base, 21, 0, 26, 4.4, Math.PI / 2, 0.065);  // E spoke  x[8,34]
    this.addRoad(base, -21, 0, 26, 4.4, Math.PI / 2, 0.065); // W spoke  x[-34,-8]
    // a roundabout around The Nexus in the central plaza
    const band = new THREE.Mesh(
      new THREE.RingGeometry(4.6, 8, 48),
      new THREE.MeshStandardMaterial({
        color: 0x171a22, emissive: 0x0a1420, emissiveIntensity: 0.5,
        roughness: 0.42, metalness: 0.5, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }),
    );
    band.rotation.x = -Math.PI / 2; band.position.y = 0.07; this.scene.add(band);
    const laneLine = new THREE.Mesh(
      new THREE.TorusGeometry(6.3, 0.06, 6, 56),
      new THREE.MeshStandardMaterial({ color: 0x0c1018, emissive: 0x16e0ff, emissiveIntensity: 1.2 }),
    );
    laneLine.rotation.x = Math.PI / 2; laneLine.position.y = 0.09; this.scene.add(laneLine);
    // elevated highways forming a ring that FRAMES the city (outside the play
    // bounds, so they never cross the plaza or the streets)
    this.addHighway(0, 36, 100, Math.PI / 2, 10);  // north overpass (runs E–W)
    this.addHighway(0, -36, 100, Math.PI / 2, 8);  // south overpass (runs E–W)
    this.addHighway(-44, 2, 80, 0, 11);            // west overpass (runs N–S)
    this.addHighway(46, -2, 80, 0, 9);             // east overpass (runs N–S)
  }

  // ---------------- physical shop buildings ----------------
  private buildShops() {
    // a marketplace plaza just south of spawn — each is a building you walk up
    // to and press E to enter its store.
    const shops: Array<{ name: string; sub: string; accent: number; x: number; z: number; open: () => void }> = [
      { name: 'AGENT SHOP', sub: 'chassis & shells',     accent: 0xffcf3a, x: -7.5, z: -6,  open: () => this.openRoster() },
      { name: 'CHIP SHOP',  sub: 'battlechips',          accent: 0xff5db4, x: 7.5,  z: -6,  open: () => this.openShop() },
      { name: 'EXCHANGE',   sub: '◊ FLUX · daily ops',   accent: 0x67e0ff, x: -7.5, z: -18, open: () => this.openOps() },
    ];
    for (const s of shops) this.makeBuilding(s.name, s.sub, s.accent, s.x, s.z, s.open);
    // plaza fill so the storefronts read against the dark ground
    const plaza = new THREE.PointLight(0xdfe8ff, 22, 60);
    plaza.position.set(0, 12, -8);
    this.scene.add(plaza);
    void this.loadShopModel(); // swap in the AI 3D model if it loads (else keep boxes)
  }

  private makeBuilding(name: string, sub: string, accent: number, x: number, z: number, open: () => void) {
    const W = 6, H = 5, D = 5;
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // procedural body — the robust default (a late-loading GLB replaces this)
    const body = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x141a30, emissive: new THREE.Color(accent).multiplyScalar(0.14),
      roughness: 0.85, metalness: 0.25,
    });
    const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat);
    box.position.y = H / 2; body.add(box);
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)),
      new THREE.LineBasicMaterial({ color: accent }),
    );
    frame.position.y = H / 2; body.add(frame);
    const door = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 3.2),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    door.position.set(0, 1.7, D / 2 + 0.04); body.add(door);
    group.add(body);

    // floating sign above the storefront
    const sign = this.makeSign(name, sub, accent);
    sign.position.set(0, H + 1.4, D / 2 - 0.2);
    group.add(sign);
    this.scene.add(group);

    this.buildings.push({ group, body, accent });
    this.obstacles.push({ x, z, rx: W / 2, rz: D / 2 });
    this.buildingRects.push({ x, z, rx: W / 2, rz: D / 2 });

    // interact marker at the door (a glowing orb you walk up to; E enters)
    const hex = '#' + accent.toString(16).padStart(6, '0');
    const marker = this.makeSprite(orbTexture('#ffffff', hex), 1.3);
    this.addActor(marker, x, z + D / 2 + 1.3, 1.3, 3.4,
      () => `Enter · ${name}`, open, 0.16);
  }

  private makeSign(name: string, sub: string, accent: number): THREE.Sprite {
    const c = document.createElement('canvas'); c.width = 512; c.height = 160;
    const g = c.getContext('2d')!;
    const hex = '#' + accent.toString(16).padStart(6, '0');
    g.fillStyle = 'rgba(8,12,24,0.86)';
    g.beginPath(); g.roundRect(8, 8, 496, 144, 16); g.fill();
    g.lineWidth = 4; g.strokeStyle = hex; g.shadowColor = hex; g.shadowBlur = 18;
    g.beginPath(); g.roundRect(8, 8, 496, 144, 16); g.stroke();
    g.shadowBlur = 14; g.fillStyle = hex;
    g.font = 'bold 60px ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, 256, 64);
    g.shadowBlur = 0; g.fillStyle = '#cfe0ff';
    g.font = '500 30px ui-monospace, monospace';
    g.fillText(sub, 256, 116);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    sp.scale.set(6.4, 2.0, 1);
    return sp;
  }

  // Swap the AI-generated 3D model into every shop (one model, reused). If the
  // GLB is missing or fails, the procedural boxes stay — the game never breaks.
  private async loadShopModel() {
    try {
      const gltf = await new GLTFLoader().loadAsync('/models/shop.glb');
      const model = gltf.scene;
      // normalize: scale to a target height, center on x/z, sit on the ground
      const bb = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3(); bb.getSize(size);
      const center = new THREE.Vector3(); bb.getCenter(center);
      const scale = 7.0 / (Math.max(size.x, size.y, size.z) || 1);
      model.scale.setScalar(scale);
      model.position.set(-center.x * scale, -bb.min.y * scale, -center.z * scale);
      model.rotation.y = Math.PI; // face the storefront toward the plaza (+z)
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = false; mesh.receiveShadow = false;
        // self-illuminate the baked texture so the dark building's neon trim
        // glows (and bloom catches it) instead of reading as a black blob.
        const mm = mesh.material as THREE.MeshStandardMaterial;
        if (mm) {
          mm.emissive = new THREE.Color(0xffffff);
          mm.emissiveMap = mm.map ?? null;
          mm.emissiveIntensity = 0.9;
          mm.needsUpdate = true;
        }
      });
      for (const b of this.buildings) {
        b.group.remove(b.body);
        b.group.add(model.clone(true));
      }
    } catch { /* keep the procedural buildings */ }
  }

  private blocked(x: number, z: number): boolean {
    for (const o of this.obstacles)
      if (Math.abs(x - o.x) < o.rx + PLAYER_R && Math.abs(z - o.z) < o.rz + PLAYER_R) return true;
    return false;
  }

  // A cave-mouth portal: a dark rocky arch with a black interior and a sickly
  // green glow — the entrance to the rat dungeon (THE WARRENS).
  private makeCavePortal(x: number, z: number) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    // black interior so the mouth reads as a hole into the dark
    const mouth = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 28),
      new THREE.MeshBasicMaterial({ color: 0x06040a }),
    );
    mouth.position.set(0, 2.3, -1.3); // faces +z toward the approaching player
    g.add(mouth);
    // chunky dark boulders arching around the mouth
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3b332c, roughness: 1, flatShading: true, emissive: 0x0a0805 });
    const ring: Array<[number, number, number]> = [
      [-3.1, 0.9, 1.7], [-2.7, 3.0, 1.5], [-1.5, 4.6, 1.6], [0, 5.3, 1.8],
      [1.5, 4.6, 1.6], [2.7, 3.0, 1.5], [3.1, 0.9, 1.7], [-2.2, 0.5, 1.3], [2.2, 0.5, 1.3],
    ];
    for (const [rx, ry, s] of ring) {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
      rock.position.set(rx, ry, -0.6 + Math.random() * 0.4);
      rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      rock.scale.y *= 1.1;
      g.add(rock);
    }
    this.scene.add(g);
    // warm fill so the cave mouth reads against the night void
    const cl = new THREE.PointLight(0xffc89a, 16, 26);
    cl.position.set(x, 7, z + 4);
    this.scene.add(cl);
    void this.loadCaveModel(x, z, g); // swap in the AI 3D cave entrance if it loads
    // green sewer glow + the interact marker at the mouth
    const orb = this.makeSprite(orbTexture('#d6ffcf', '#39c46a'), 2.8);
    this.addActor(orb, x, z + 1.0, 2.2, 3.2,
      () => 'Enter THE WARRENS ·  🐀',
      () => this.opts.onPortal?.('rat'), 0.18);
    this.obstacles.push({ x, z: z - 0.7, rx: 3.4, rz: 1.6 }); // can't walk through the rocks
  }

  // Replace the procedural rock arch with the Trellis-generated cave-mouth GLB.
  private async loadCaveModel(x: number, z: number, fallback: THREE.Group) {
    try {
      const gltf = await new GLTFLoader().loadAsync('/models/cave.glb');
      const model = gltf.scene;
      const bb = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3(); bb.getSize(size);
      const center = new THREE.Vector3(); bb.getCenter(center);
      const scale = 8.5 / (Math.max(size.x, size.y, size.z) || 1);
      model.scale.setScalar(scale);
      model.position.set(x - center.x * scale, -bb.min.y * scale, z - center.z * scale);
      model.rotation.y = Math.PI; // face the mouth toward the plaza (+z / player side)
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mm = mesh.material as THREE.MeshStandardMaterial;
        if (mm) { mm.emissive = new THREE.Color(0x2e2618); mm.emissiveMap = mm.map ?? null; mm.emissiveIntensity = 0.7; mm.needsUpdate = true; }
      });
      this.scene.remove(fallback);
      this.scene.add(model);
    } catch { /* keep the procedural rock arch */ }
  }

  private buildShards() {
    const spots: Array<[number, number]> = [
      [5, -11], [-14, -12], [22, 4], [-26, -3], [13, 20],
      [-10, 22], [31, 9], [-31, 13], [36, -6], [-36, -19],
      [20, -20], [-22, 19],
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
      [9, 9, 'INNER FLATS'],
      [27, 3, 'OUTER GRID'],
      [30, -22, 'DEEP SECTORS'],
      [-30, -8, 'WEST EXPANSE'],
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
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.95, 0.62, 0.62,
    ));
    this.composer.addPass(new ShaderPass(GradeShader));
    this.rainPass = new ShaderPass(RainShader);
    this.composer.addPass(this.rainPass);
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
        // move per-axis so you slide along shop walls instead of sticking
        const nx = THREE.MathUtils.clamp(this.pos.x + (dx / len) * spd * dt, -BOUNDS.x, BOUNDS.x);
        const nz = THREE.MathUtils.clamp(this.pos.y + (dz / len) * spd * dt, -BOUNDS.z, BOUNDS.z);
        if (!this.blocked(nx, this.pos.y)) this.pos.x = nx;
        if (!this.blocked(this.pos.x, nz)) this.pos.y = nz;
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

    // searchlights sweep across the city
    for (let i = 0; i < this.searchlights.length; i++) {
      const ph = t * 0.22 + i * 3.0;
      this.searchlights[i].position.set(Math.sin(ph) * 34, 0.06, Math.cos(ph * 0.7) * 22);
    }

    // The Nexus — slow swirl + pulsing core glow
    if (this.nexus) {
      this.nexus.rotation.y += dt * 0.5;
      const core = this.nexus.children[0] as THREE.Mesh;
      const cm = core.material as THREE.MeshStandardMaterial;
      cm.emissiveIntensity = 1.2 + Math.sin(t * 2.2) * 0.4;
    }

    // ---- weather: rain rolls in, then clears off, on a slow cycle ----
    this.weatherT -= dt;
    if (this.weatherT <= 0) {
      const goWet = this.weatherTarget < 0.5;
      this.weatherTarget = goWet ? 1 : 0;
      this.weatherT = goWet ? 34 + Math.random() * 40 : 26 + Math.random() * 34;
      this.toast(goWet ? '▓ rain moving in' : '☼ skies clearing');
    }
    this.weather += (this.weatherTarget - this.weather) * Math.min(1, dt * 0.12);
    const wet = this.weather;
    // wet ground turns glossier with more neon sheen; fog closes in when it pours
    if (this.topMat) {
      this.topMat.metalness = 0.3 + wet * 0.35;
      this.topMat.emissiveIntensity = 0.32 + wet * 0.22 + Math.sin(t * 1.3) * 0.02 * wet;
    }
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.far = 240 - wet * 70;

    // rain overlay + cyan lightning — only when it's actually raining
    this.rainPass.uniforms.time.value = t;
    this.rainPass.uniforms.intensity.value = wet;
    if (this.flashT <= 0 && Math.random() < dt * 0.05 * wet) this.flashT = 0.22;
    this.flashT = Math.max(0, this.flashT - dt * 1.4);
    this.rainPass.uniforms.flash.value = this.flashT * (0.6 + 0.4 * Math.random()) * wet;

    // highway traffic streaks
    for (const c of this.traffic) {
      let z = c.mesh.position.z + c.speed * dt;
      const half = c.len / 2;
      if (z > half) z -= c.len; else if (z < -half) z += c.len;
      c.mesh.position.z = z;
    }

    // neon signage flicker (occasional brown-out dip)
    for (const nf of this.neonLights) {
      const f = 0.82 + 0.18 * Math.sin(t * 3.0 + nf.ph) + (Math.random() < 0.01 ? -0.4 : 0);
      nf.l.intensity = nf.base * Math.max(0.3, f);
    }

    // drift the low ground haze
    for (let i = 0; i < this.mist.length; i++) {
      const m = this.mist[i];
      m.position.x += dt * (0.4 + (i % 3) * 0.2);
      if (m.position.x > 42) m.position.x = -42;
    }

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
