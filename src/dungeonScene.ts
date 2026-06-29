import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { orbTexture, humanoidTexture } from './sprites.ts';
import type { AgentBody } from './sprites.ts';
import { getCredits, addCredits, getSelectedCharacter, getSelectedBody, tintColor } from './characters.ts';
import { playSfx } from './sfx.ts';
import type { Session } from './wallet.ts';
import {
  getRun, isFloor, nodeAt, clearNodeAt, tileKey, type DungeonRun, type DungeonNode,
} from './dungeon.ts';

// Vignette + slight grade, matching the overworld's HD-2D look.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, darkness: { value: 0.95 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float darkness; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = clamp(1.0 - dot(d, d) * darkness, 0.0, 1.0);
      c.rgb *= mix(0.6, 1.0, v);
      c.rgb = (c.rgb - 0.5) * 1.08 + 0.5;
      gl_FragColor = c;
    }`,
};

type Dir = 'down' | 'up' | 'left' | 'right';

export interface DungeonOpts {
  // step onto a process / boss → hand off to the real BattleScene
  onBattle: (enemyIndex: number, boss: boolean) => void;
  // abandon the run (keep looted Credits) → back to the overworld
  onLeave: () => void;
}

const TILE = 2.4;
// biome tint by distance-from-start tier: the maze shifts cyan → magenta → amber
// as you push deeper toward the boss core.
const TIER_COLORS = [0x37c8ff, 0xc46bff, 0xffb24a];

export class DungeonScene {
  private renderer: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raf = 0;
  private run: DungeonRun;

  private player!: THREE.Sprite;
  private playerBaseY = 1.35;
  private torch!: THREE.PointLight;
  private motes!: THREE.Points;
  private decor: Array<{ obj: THREE.Object3D; type: 'pylon' | 'core'; spin: number; baseY: number; bob: number }> = [];
  private panelCache = new Map<string, THREE.Texture>();
  private cur = new THREE.Vector2();      // current world pos (x,z)
  private targetTile: { col: number; row: number };
  private pendingArrive = false;
  private dirTex!: Record<Dir, THREE.Texture>;
  private busy = false;                    // true while handing off / modal open
  private leaveOpen = false;

  private tokens = new Map<number, { sprite: THREE.Sprite; baseY: number; phase: number }>();
  private camDist = 1;                     // wheel zoom multiplier

  private keys: Record<string, boolean> = {};
  private fresh: string[] = [];

  private dom: HTMLElement[] = [];
  private hudCredits!: HTMLElement;
  private hudStatus!: HTMLElement;
  private toastEl!: HTMLElement;
  private toastT = 0;
  private mini!: HTMLCanvasElement;
  private miniT = 0;

  constructor(private container: HTMLElement, _session: Session, private opts: DungeonOpts) {
    const run = getRun();
    if (!run) throw new Error('DungeonScene constructed without an active run');
    this.run = run;
    this.targetTile = { ...run.player };

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);

    this.build();
    this.buildPost();
    this.buildHUD();

    this.cur.set(this.wx(run.player.col), this.wz(run.player.row));
    this.syncPlayer();
    this.updateCamera(true);

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false });
    if (new URLSearchParams(location.search).has('dev')) (window as { __dg?: DungeonScene }).__dg = this;

    this.toast(`DEPTH ${this.run.depth} · reach the core`);
    this.loop();
  }

  // ---- tile <-> world ----
  private wx(col: number) { return (col - (this.run.tw - 1) / 2) * TILE; }
  private wz(row: number) { return (row - (this.run.th - 1) / 2) * TILE; }

  private build() {
    const run = this.run;
    // Mega Man Battle Network "Net" look: glowing data-roads suspended in a black
    // cyber-void. Panels light themselves (emissive + bloom) so the void stays dark.
    this.scene.fog = new THREE.Fog(0x02030a, TILE * 8, TILE * 22);
    this.scene.background = this.voidBackground();

    this.scene.add(new THREE.AmbientLight(0x4a5894, 1.1));
    // a soft cool key + a gentle follow glow (panels do most of the lighting)
    const key = new THREE.DirectionalLight(0xbfd4ff, 0.5);
    key.position.set(-4, 12, 6);
    this.scene.add(key);
    this.torch = new THREE.PointLight(0x8fe0ff, 14, TILE * 8, 1.6);
    this.torch.position.set(0, 4.5, 0);
    this.scene.add(this.torch);

    // deep wire-grid floor far below, glimpsed through the gaps between roads —
    // the classic "suspended over the Net" depth cue.
    const grid = new THREE.GridHelper(TILE * Math.max(run.tw, run.th) * 2.2, 48, 0x1a3a6a, 0x0e2046);
    grid.position.y = -9;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    this.scene.add(grid);

    // drifting data-motes for atmosphere
    this.motes = this.makeMotes();
    this.scene.add(this.motes);

    // ---- which tiles are floor + their biome tier (distance from start) ----
    const floorIdx: number[] = [];
    for (let r = 0; r < run.th; r++)
      for (let c = 0; c < run.tw; c++)
        if (run.tiles[r * run.tw + c] === 1) floorIdx.push(r * run.tw + c);
    const tier = this.tierMap();
    const nbCount = (c: number, r: number) =>
      (isFloor(run, c + 1, r) ? 1 : 0) + (isFloor(run, c - 1, r) ? 1 : 0) +
      (isFloor(run, c, r + 1) ? 1 : 0) + (isFloor(run, c, r - 1) ? 1 : 0);

    // ---- floor panels grouped by (tier colour × variant detail) ----
    // junctions get a "hub" node panel, some tiles get circuitry, rest are plain;
    // the whole group is tinted by its distance tier so the maze reads as biomes.
    const floorGeo = new THREE.BoxGeometry(TILE, 0.28, TILE);
    const m = new THREE.Matrix4();
    const groups = new Map<string, number[]>();
    for (const k of floorIdx) {
      const c = k % run.tw, r = (k / run.tw) | 0;
      const t = Math.max(0, tier[k]);
      const v = nbCount(c, r) >= 3 ? 'node' : (this.hash(k) % 5 === 0 ? 'circuit' : 'plain');
      const arr = groups.get(t + ':' + v); if (arr) arr.push(k); else groups.set(t + ':' + v, [k]);
    }
    for (const [gk, keys] of groups) {
      const [tStr, v] = gk.split(':');
      const tex = this.panelTex(v);
      const mat = new THREE.MeshStandardMaterial({
        map: tex, emissiveMap: tex, emissive: new THREE.Color(TIER_COLORS[+tStr]),
        emissiveIntensity: 0.7, color: 0x16294f, roughness: 0.9, metalness: 0.1,
      });
      const mesh = new THREE.InstancedMesh(floorGeo, mat, keys.length);
      keys.forEach((k, i) => {
        const c = k % run.tw, r = (k / run.tw) | 0;
        m.makeTranslation(this.wx(c), -0.14, this.wz(r));
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
    }

    // ---- edge rails (glowing curb where a road meets the void), tinted by tier ----
    const RAIL_H = 0.55, RAIL_T = 0.16, railY = RAIL_H / 2 - 0.02;
    const railGeo = new THREE.BoxGeometry(TILE, RAIL_H, RAIL_T);
    const q = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const edges: Array<[number, number, boolean]> = [[0, -1, false], [0, 1, false], [-1, 0, true], [1, 0, true]];
    const railByTier: THREE.Matrix4[][] = [[], [], []];
    for (const k of floorIdx) {
      const c = k % run.tw, r = (k / run.tw) | 0; const t = Math.max(0, tier[k]);
      for (const [dc, dr, vert] of edges) {
        if (isFloor(run, c + dc, r + dr)) continue;
        q.setFromAxisAngle(yAxis, vert ? Math.PI / 2 : 0);
        const pos = new THREE.Vector3(this.wx(c) + dc * TILE / 2, railY, this.wz(r) + dr * TILE / 2);
        railByTier[t].push(new THREE.Matrix4().compose(pos, q, one));
      }
    }
    railByTier.forEach((mats, t) => {
      if (!mats.length) return;
      const mat = new THREE.MeshStandardMaterial({ color: 0x0a1830, emissive: new THREE.Color(TIER_COLORS[t]), emissiveIntensity: 1.5, roughness: 0.6 });
      const mesh = new THREE.InstancedMesh(railGeo, mat, mats.length);
      mats.forEach((mm, i) => mesh.setMatrixAt(i, mm));
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
    });

    // ---- decorative set-dressing: pylons in the void, data-cores over hubs ----
    this.buildProps(tier, nbCount);

    // ---- node tokens (loot / enemy / boss) ----
    for (const [k, n] of run.nodes) {
      if (n.cleared) continue;
      const c = k % run.tw, r = (k / run.tw) | 0;
      const { tex, scale, y } = this.tokenLook(n);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      sp.scale.set(scale, scale, 1);
      sp.position.set(this.wx(c), y, this.wz(r));
      this.scene.add(sp);
      this.tokens.set(k, { sprite: sp, baseY: y, phase: Math.random() * 6.28 });
    }

    // entrance & exit glow pads
    this.addPad(run.start.col, run.start.row, 0x39ffae);
    this.addPad(run.boss.col, run.boss.row, 0xff4d6d);

    // ---- player ----
    const tint = tintColor(getSelectedCharacter());
    const body = getSelectedBody();
    this.dirTex = {
      down: humanoidTexture(tint, 'front', 0.45, body as AgentBody),
      up: humanoidTexture(tint, 'back', 0.45, body as AgentBody),
      left: humanoidTexture(tint, 'left', 0.45, body as AgentBody),
      right: humanoidTexture(tint, 'right', 0.45, body as AgentBody),
    };
    const pmat = new THREE.SpriteMaterial({ map: this.dirTex.down, transparent: true });
    pmat.color.setScalar(1.25); // sprites are unlit; lift it so it reads over the dark void
    this.player = new THREE.Sprite(pmat);
    this.player.scale.set(3.0, 3.0, 1);
    this.scene.add(this.player);
  }

  // A "Net" panel variant: dark fill + near-white detail/border (so the floor
  // material's emissive tier-colour tints it). plain = crosshatch, node = a hub
  // emblem for junctions, circuit = traces. Cached per variant.
  private panelTex(variant: string): THREE.Texture {
    const hit = this.panelCache.get(variant); if (hit) return hit;
    const s = 128;
    const cv = document.createElement('canvas'); cv.width = cv.height = s;
    const g = cv.getContext('2d')!;
    const bg = g.createLinearGradient(0, 0, s, s);
    bg.addColorStop(0, '#12224a'); bg.addColorStop(1, '#0b1530');
    g.fillStyle = bg; g.fillRect(0, 0, s, s);
    const line = 'rgba(220,244,255,0.95)';
    if (variant === 'node') {
      g.strokeStyle = 'rgba(170,230,255,0.6)'; g.lineWidth = 2;
      for (const [x, y] of [[64, 12], [64, 116], [12, 64], [116, 64]]) {
        g.beginPath(); g.moveTo(64, 64); g.lineTo(x, y); g.stroke();
      }
      g.beginPath();
      for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; const px = 64 + 24 * Math.cos(a), py = 64 + 24 * Math.sin(a); i ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.closePath(); g.strokeStyle = line; g.lineWidth = 3; g.stroke();
      g.fillStyle = line; g.beginPath(); g.arc(64, 64, 6, 0, 6.3); g.fill();
    } else if (variant === 'circuit') {
      g.strokeStyle = 'rgba(160,215,255,0.55)'; g.lineWidth = 3; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(22, 42); g.lineTo(64, 42); g.lineTo(64, 92); g.lineTo(104, 92); g.stroke();
      g.fillStyle = 'rgba(190,235,255,0.85)';
      g.beginPath(); g.arc(22, 42, 4, 0, 6.3); g.fill();
      g.beginPath(); g.arc(104, 92, 5, 0, 6.3); g.fill();
    } else {
      g.strokeStyle = 'rgba(70,120,200,0.22)'; g.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        g.beginPath(); g.moveTo((i * s) / 4, 6); g.lineTo((i * s) / 4, s - 6); g.stroke();
        g.beginPath(); g.moveTo(6, (i * s) / 4); g.lineTo(s - 6, (i * s) / 4); g.stroke();
      }
    }
    const pad = 6, w = s - pad * 2;
    g.strokeStyle = line; g.lineWidth = 6; g.lineJoin = 'round'; g.strokeRect(pad, pad, w, w);
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2; g.strokeRect(pad + 5, pad + 5, w - 10, w - 10);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    this.panelCache.set(variant, tex); return tex;
  }

  // distance-from-start tier (0..2) per tile; -1 for void
  private tierMap(): Int32Array {
    const { tw, th, tiles, start } = this.run;
    const dist = new Int32Array(tw * th).fill(-1);
    const q = [start.row * tw + start.col]; dist[q[0]] = 0; let maxD = 1;
    for (let h = 0; h < q.length; h++) {
      const k = q[h], c = k % tw, r = (k / tw) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dx, nr = r + dy; if (nc < 0 || nr < 0 || nc >= tw || nr >= th) continue;
        const nk = nr * tw + nc; if (tiles[nk] === 1 && dist[nk] < 0) { dist[nk] = dist[k] + 1; maxD = Math.max(maxD, dist[nk]); q.push(nk); }
      }
    }
    const tier = new Int32Array(tw * th).fill(-1);
    for (let i = 0; i < dist.length; i++) if (dist[i] >= 0) tier[i] = Math.min(2, Math.floor((dist[i] / maxD) * 2.999));
    return tier;
  }

  private hash(n: number): number {
    n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4);
    n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return n >>> 0;
  }

  // tier of a void tile = tier of an adjacent road tile (for tinting flanking props)
  private nearestTier(c: number, r: number, tier: Int32Array): number {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = (r + dy) * this.run.tw + (c + dx);
      if (k >= 0 && k < tier.length && tier[k] >= 0) return tier[k];
    }
    return 0;
  }

  // scatter decorative pylons (in the void, flanking roads) + floating data-cores
  // (over junction hubs). Procedural by default; the GLB models swap in if loaded.
  private buildProps(tier: Int32Array, nbCount: (c: number, r: number) => number) {
    const run = this.run;
    let pyl = 0, core = 0;
    for (let r = 0; r < run.th; r++) for (let c = 0; c < run.tw; c++) {
      const k = r * run.tw + c;
      if (run.tiles[k] === 1) continue;
      const borders = isFloor(run, c + 1, r) || isFloor(run, c - 1, r) || isFloor(run, c, r + 1) || isFloor(run, c, r - 1);
      if (!borders || pyl >= 24) continue;
      if (this.hash(k * 7 + 1) % 5 !== 0) continue; // ~1 in 5 flanking void tiles
      const color = TIER_COLORS[this.nearestTier(c, r, tier)];
      const obj = this.makePylon(color);
      obj.position.set(this.wx(c), 0, this.wz(r));
      this.scene.add(obj);
      this.decor.push({ obj, type: 'pylon', spin: 0, baseY: 0, bob: 0 });
      pyl++;
    }
    for (let r = 0; r < run.th; r++) for (let c = 0; c < run.tw; c++) {
      const k = r * run.tw + c;
      if (run.tiles[k] !== 1 || nbCount(c, r) < 3 || core >= 16) continue;
      if (this.hash(k * 13 + 5) % 2 !== 0) continue;
      const color = TIER_COLORS[Math.max(0, tier[k])];
      const obj = this.makeCore(color);
      const y = 3.1; obj.position.set(this.wx(c), y, this.wz(r));
      this.scene.add(obj);
      this.decor.push({ obj, type: 'core', spin: 0.5, baseY: y, bob: this.hash(k) % 628 / 100 });
      core++;
    }
    void this.loadProps();
  }

  // a tall neon server-pylon rising out of the void beside the road
  private makePylon(color: number): THREE.Group {
    const grp = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x0c1428, emissive: new THREE.Color(color).multiplyScalar(0.12), roughness: 0.8 });
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.7, 4.6, 0.7), dark);
    shaft.position.y = 0.4; grp.add(shaft);
    const band = new THREE.MeshStandardMaterial({ color: 0x0c1428, emissive: new THREE.Color(color), emissiveIntensity: 1.4, roughness: 0.5 });
    for (const by of [-1.2, 0.2, 1.6]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.18, 0.82), band);
      b.position.y = 0.4 + by; grp.add(b);
    }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12),
      new THREE.MeshBasicMaterial({ color }));
    tip.position.y = 2.95; grp.add(tip);
    return grp;
  }

  // a floating data-core: glowing diamond inside a ring
  private makeCore(color: number): THREE.Group {
    const grp = new THREE.Group();
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.5),
      new THREE.MeshStandardMaterial({ color: 0x0c1428, emissive: new THREE.Color(color), emissiveIntensity: 1.3, roughness: 0.4 }));
    grp.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.06, 8, 28),
      new THREE.MeshStandardMaterial({ color: 0x0c1428, emissive: new THREE.Color(color), emissiveIntensity: 1.1 }));
    ring.rotation.x = Math.PI / 2.4; grp.add(ring);
    return grp;
  }

  // swap the AI-generated prop GLBs in for the procedural ones (best-effort)
  private async loadProps() {
    const swap = async (type: 'pylon' | 'core', url: string, targetH: number, baseY: number) => {
      try {
        const gltf = await new GLTFLoader().loadAsync(url);
        const model = gltf.scene;
        const bb = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3(); bb.getSize(size);
        const center = new THREE.Vector3(); bb.getCenter(center);
        const scale = targetH / (Math.max(size.x, size.y, size.z) || 1);
        model.scale.setScalar(scale);
        model.position.set(-center.x * scale, -bb.min.y * scale, -center.z * scale);
        model.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mm = mesh.material as THREE.MeshStandardMaterial;
          if (mm) { mm.emissive = new THREE.Color(0x2a4a7a); mm.emissiveMap = mm.map ?? null; mm.emissiveIntensity = 0.85; mm.needsUpdate = true; }
        });
        for (const d of this.decor) {
          if (d.type !== type) continue;
          const pos = d.obj.position.clone();
          this.scene.remove(d.obj);
          const inst = model.clone(true);
          inst.position.copy(pos); inst.position.y = baseY;
          this.scene.add(inst);
          d.obj = inst;
        }
      } catch { /* keep procedural */ }
    };
    await Promise.all([
      swap('pylon', '/models/pylon.glb', 5.2, 0),
      swap('core', '/models/datacore.glb', 1.9, 3.1),
    ]);
  }

  // radial dark-blue → black void backdrop
  private voidBackground(): THREE.Texture {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const g = cv.getContext('2d')!;
    const rg = g.createRadialGradient(128, 110, 30, 128, 128, 200);
    rg.addColorStop(0, '#0a1430'); rg.addColorStop(0.6, '#050a1c'); rg.addColorStop(1, '#01020a');
    g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private makeMotes(): THREE.Points {
    const n = 260;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3);
    const span = TILE * Math.max(this.run.tw, this.run.th);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (Math.random() - 0.5) * span;
      p[i * 3 + 1] = Math.random() * 12 - 1;
      p[i * 3 + 2] = (Math.random() - 0.5) * span;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x6fe0ff, size: 0.14, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    return new THREE.Points(g, mat);
  }

  private addPad(col: number, row: number, color: number) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(TILE * 0.28, TILE * 0.42, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(this.wx(col), 0.04, this.wz(row));
    this.scene.add(ring);
  }

  private tokenLook(n: DungeonNode): { tex: THREE.Texture; scale: number; y: number } {
    if (n.kind === 'loot') return { tex: orbTexture('#fff6d0', '#e3a626'), scale: 1.5, y: 1.0 };
    if (n.kind === 'boss') return { tex: orbTexture('#ffd6ff', '#b03aff'), scale: 3.2, y: 1.7 };
    return { tex: orbTexture('#ffd9e6', '#ff4d6d'), scale: 1.9, y: 1.15 }; // enemy
  }

  private buildPost() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.5, 0.8,
    ));
    this.composer.addPass(new ShaderPass(GradeShader));
    this.composer.addPass(new OutputPass());
  }

  // ---------------- HUD ----------------
  private buildHUD() {
    const title = document.createElement('div');
    title.id = 'dg-title';
    title.innerHTML = `▣ THE GRID DUNGEON <span class="db-dim">· DEPTH ${this.run.depth}</span>`;
    this.container.appendChild(title); this.dom.push(title);

    const credits = document.createElement('div');
    credits.id = 'dg-credits';
    this.container.appendChild(credits); this.dom.push(credits);
    this.hudCredits = credits;

    const status = document.createElement('div');
    status.id = 'dg-status';
    this.container.appendChild(status); this.dom.push(status);
    this.hudStatus = status;
    this.updateHud();

    const leave = document.createElement('button');
    leave.className = 'btn';
    leave.id = 'dg-leave';
    leave.textContent = '✕ LEAVE';
    leave.onclick = () => this.openLeave();
    this.container.appendChild(leave); this.dom.push(leave);

    const hint = document.createElement('div');
    hint.id = 'dg-hint';
    hint.innerHTML = `<kbd>WASD</kbd> move &nbsp; reach the <b style="color:#ff7a9c">core</b> &nbsp; <kbd>Esc</kbd> leave`;
    this.container.appendChild(hint); this.dom.push(hint);

    const toast = document.createElement('div');
    toast.id = 'dg-toast';
    this.container.appendChild(toast); this.dom.push(toast);
    this.toastEl = toast;

    // minimap
    const mini = document.createElement('canvas');
    mini.id = 'dg-mini';
    mini.width = 168; mini.height = 168;
    this.container.appendChild(mini); this.dom.push(mini);
    this.mini = mini;
    this.drawMini();
  }

  private updateHud() {
    if (this.hudCredits) this.hudCredits.innerHTML = `<span>◈</span> ${getCredits()}`;
    const total = [...this.run.nodes.values()].filter((n) => n.kind === 'enemy').length;
    const left = [...this.run.nodes.values()].filter((n) => n.kind === 'enemy' && !n.cleared).length;
    if (this.hudStatus) this.hudStatus.innerHTML =
      `◈ +${this.run.creditsLooted} looted &nbsp;·&nbsp; processes ${total - left}/${total}`;
  }

  private toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = '1';
    this.toastT = 2.2;
  }

  private openLeave() {
    if (this.leaveOpen || this.busy) return;
    this.leaveOpen = true;
    const el = document.createElement('div');
    el.id = 'dg-leavemodal';
    el.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(4,4,12,.7)';
    el.innerHTML = `<div class="roster-panel" style="max-width:360px;text-align:center">
      <h2>ABANDON RUN?</h2>
      <div class="sub" style="margin:8px 0 16px">You keep the <b>◈ ${this.run.creditsLooted}</b> looted so far, but lose the boss reward.</div>
      <button class="btn" data-act="leave" style="display:block;width:100%;margin:6px 0">Extract now</button>
      <button class="btn" data-act="stay" style="display:block;width:100%;margin:6px 0">Keep going · Esc</button>
    </div>`;
    this.container.appendChild(el); this.dom.push(el);
    const close = () => { this.leaveOpen = false; el.remove(); };
    (el.querySelector('[data-act="leave"]') as HTMLElement).onclick = () => { close(); this.opts.onLeave(); };
    (el.querySelector('[data-act="stay"]') as HTMLElement).onclick = close;
  }

  // ---------------- input ----------------
  private gameKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyE']);
  private onKeyDown = (e: KeyboardEvent) => {
    if (this.gameKeys.has(e.code)) e.preventDefault();
    if (this.keys[e.code]) return;
    this.keys[e.code] = true; this.fresh.push(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys[e.code] = false; };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.camDist = THREE.MathUtils.clamp(this.camDist + e.deltaY * 0.001, 0.7, 1.8);
  };

  private face(dir: Dir) {
    const mat = this.player.material as THREE.SpriteMaterial;
    mat.map = this.dirTex[dir]; mat.needsUpdate = true;
  }

  private arrived(): boolean {
    return this.cur.distanceTo(new THREE.Vector2(this.wx(this.targetTile.col), this.wz(this.targetTile.row))) < 0.04;
  }

  private tryStep() {
    if (this.busy || this.leaveOpen || !this.arrived()) return;
    let dx = 0, dy = 0, dir: Dir | null = null;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) { dx = -1; dir = 'left'; }
    else if (this.keys['KeyD'] || this.keys['ArrowRight']) { dx = 1; dir = 'right'; }
    else if (this.keys['KeyW'] || this.keys['ArrowUp']) { dy = -1; dir = 'up'; }
    else if (this.keys['KeyS'] || this.keys['ArrowDown']) { dy = 1; dir = 'down'; }
    if (!dir) return;
    this.face(dir);
    const nc = this.targetTile.col + dx, nr = this.targetTile.row + dy;
    if (!isFloor(this.run, nc, nr)) return; // wall — just turned to face it
    this.targetTile = { col: nc, row: nr };
    this.run.player = { col: nc, row: nr };
    this.run.visited.add(tileKey(this.run, nc, nr));
    this.pendingArrive = true;
  }

  private onArrive() {
    const { col, row } = this.targetTile;
    const n = nodeAt(this.run, col, row);
    if (!n) return;
    if (n.kind === 'loot') {
      n.cleared = true;
      addCredits(n.reward ?? 0);
      this.run.creditsLooted += n.reward ?? 0;
      const k = tileKey(this.run, col, row);
      const t = this.tokens.get(k);
      if (t) { this.scene.remove(t.sprite); this.tokens.delete(k); }
      playSfx('ui_confirm', 0.5);
      this.toast(`Data-cache · +◈ ${n.reward}`);
      this.updateHud();
      return;
    }
    // enemy or boss → hand off to a real battle
    this.busy = true;
    clearNodeAt(col, row);
    this.run.player = { col, row };
    const boss = n.kind === 'boss';
    if (boss) this.toast(`⚠ ${this.run.bossName}`);
    const flash = document.createElement('div');
    flash.style.cssText = `position:fixed;inset:0;background:${boss ? '#ffb0ff' : '#ffd0d8'};opacity:0;z-index:70;transition:opacity .35s;pointer-events:none`;
    this.container.appendChild(flash);
    requestAnimationFrame(() => { flash.style.opacity = '1'; });
    setTimeout(() => { flash.remove(); this.opts.onBattle(n.enemyIndex ?? 0, boss); }, 380);
  }

  // ---------------- loop ----------------
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    for (const code of this.fresh) {
      if (code === 'Escape') { if (this.leaveOpen) (this.dom.find((e) => e.id === 'dg-leavemodal')?.querySelector('[data-act="stay"]') as HTMLElement)?.click(); else this.openLeave(); }
    }
    this.fresh = [];

    this.tryStep();

    // slide toward the target tile
    const tx = this.wx(this.targetTile.col), tz = this.wz(this.targetTile.row);
    this.cur.lerp(new THREE.Vector2(tx, tz), Math.min(1, dt * 13));
    if (this.cur.distanceTo(new THREE.Vector2(tx, tz)) < 0.04) {
      this.cur.set(tx, tz);
      if (this.pendingArrive) { this.pendingArrive = false; this.onArrive(); }
    }
    this.syncPlayer();

    // token bob/spin
    for (const tk of this.tokens.values()) tk.sprite.position.y = tk.baseY + Math.sin(t * 2.2 + tk.phase) * 0.18;

    // decorative props: spin + bob the floating data-cores
    for (const d of this.decor) {
      if (d.spin) { d.obj.rotation.y += dt * d.spin; d.obj.position.y = d.baseY + Math.sin(t * 1.3 + d.bob) * 0.2; }
    }

    // drift data-motes upward around the player, wrapping
    const arr = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < arr.count; i++) {
      let y = arr.getY(i) + dt * 0.5;
      if (y > 12) y = -1;
      arr.setY(i, y);
    }
    arr.needsUpdate = true;
    this.motes.position.set(this.cur.x, 0, this.cur.y);

    // toast fade
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toastEl.style.opacity = '0'; }

    this.updateCamera();

    // minimap ~12fps
    this.miniT += dt;
    if (this.miniT > 0.08) { this.miniT = 0; this.drawMini(); }

    this.composer.render();
  };

  private syncPlayer() {
    const y = this.playerBaseY + Math.sin(this.clock.elapsedTime * 3) * 0.05;
    this.player.position.set(this.cur.x, y, this.cur.y);
    this.torch.position.set(this.cur.x, 5, this.cur.y);
  }

  private updateCamera(snap = false) {
    // a 3/4 down-the-corridor view (lower & closer than top-down) so the maze
    // walls read with depth, HD-2D style.
    const h = 12.5 * this.camDist, back = 9.5 * this.camDist;
    const target = new THREE.Vector3(this.cur.x, h, this.cur.y + back);
    if (snap) this.camera.position.copy(target);
    else this.camera.position.lerp(target, 0.18);
    this.camera.lookAt(this.cur.x, 0.6, this.cur.y);
  }

  // fog-of-war minimap: walls dark, explored floor lit, discovered tokens marked,
  // the boss core always flagged so you know which way to head.
  private drawMini() {
    const g = this.mini.getContext('2d');
    if (!g) return;
    const run = this.run;
    const s = this.mini.width / run.tw;
    g.clearRect(0, 0, this.mini.width, this.mini.height);
    g.fillStyle = 'rgba(4,6,14,0.86)';
    g.fillRect(0, 0, this.mini.width, this.mini.height);
    for (let r = 0; r < run.th; r++) {
      for (let c = 0; c < run.tw; c++) {
        const k = r * run.tw + c;
        if (run.tiles[k] !== 1) continue;
        const visited = run.visited.has(k);
        g.fillStyle = visited ? '#2b3e6e' : '#141a30';
        g.fillRect(c * s, r * s, s + 0.6, s + 0.6);
        if (visited) {
          const n = run.nodes.get(k);
          if (n && !n.cleared) {
            g.fillStyle = n.kind === 'loot' ? '#ffcf3a' : n.kind === 'boss' ? '#ff4d6d' : '#ff7a9c';
            g.beginPath(); g.arc(c * s + s / 2, r * s + s / 2, s * 0.32, 0, 6.3); g.fill();
          }
        }
      }
    }
    // boss core marker (always shown as the goal)
    const bk = run.boss;
    g.strokeStyle = '#ff4d6d'; g.lineWidth = 2;
    g.strokeRect(bk.col * s - 1, bk.row * s - 1, s + 2, s + 2);
    // player
    g.fillStyle = '#67e0ff';
    g.beginPath(); g.arc(this.run.player.col * s + s / 2, this.run.player.row * s + s / 2, s * 0.42, 0, 6.3); g.fill();
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.removeEventListener('wheel', this.onWheel);
    for (const el of this.dom) el.remove();
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }
}
