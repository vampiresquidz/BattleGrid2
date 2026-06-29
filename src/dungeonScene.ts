import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
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

    // ---- which tiles are floor (data-road panels) ----
    const floorIdx: number[] = [];
    for (let r = 0; r < run.th; r++)
      for (let c = 0; c < run.tw; c++)
        if (run.tiles[r * run.tw + c] === 1) floorIdx.push(r * run.tw + c);

    // ---- floor panels: dark tile, bright neon border (one per road tile) ----
    const panelTex = this.netPanelTexture();
    const floorMat = new THREE.MeshStandardMaterial({
      map: panelTex, emissiveMap: panelTex, emissive: 0xffffff, emissiveIntensity: 0.55,
      color: 0x16294f, roughness: 0.9, metalness: 0.1,
    });
    const floorGeo = new THREE.BoxGeometry(TILE, 0.28, TILE);
    const floor = new THREE.InstancedMesh(floorGeo, floorMat, floorIdx.length);
    const m = new THREE.Matrix4();
    floorIdx.forEach((k, i) => {
      const c = k % run.tw, r = (k / run.tw) | 0;
      m.makeTranslation(this.wx(c), -0.14, this.wz(r));
      floor.setMatrixAt(i, m);
    });
    floor.instanceMatrix.needsUpdate = true;
    this.scene.add(floor);

    // ---- edge rails: a low glowing curb wherever a road meets the void
    // (replaces dungeon walls — defines the path silhouette, MMBN road-edge look)
    const RAIL_H = 0.55, RAIL_T = 0.16, railY = RAIL_H / 2 - 0.02;
    const rails: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const edges: Array<[number, number, boolean]> = [[0, -1, false], [0, 1, false], [-1, 0, true], [1, 0, true]];
    for (const k of floorIdx) {
      const c = k % run.tw, r = (k / run.tw) | 0;
      for (const [dc, dr, vert] of edges) {
        if (isFloor(run, c + dc, r + dr)) continue; // neighbour is road → no rail
        q.setFromAxisAngle(yAxis, vert ? Math.PI / 2 : 0);
        const pos = new THREE.Vector3(this.wx(c) + dc * TILE / 2, railY, this.wz(r) + dr * TILE / 2);
        rails.push(new THREE.Matrix4().compose(pos, q, one));
      }
    }
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x0a1830, emissive: 0x37c8ff, emissiveIntensity: 1.4, roughness: 0.6,
    });
    const railMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE, RAIL_H, RAIL_T), railMat, rails.length);
    rails.forEach((mat, i) => railMesh.setMatrixAt(i, mat));
    railMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(railMesh);

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

  // A square "Net" panel: dark fill, bright cyan border + faint inner detail.
  // Used as both map and emissiveMap so only the bright pixels bloom.
  private netPanelTexture(): THREE.Texture {
    const s = 128;
    const cv = document.createElement('canvas'); cv.width = cv.height = s;
    const g = cv.getContext('2d')!;
    const bg = g.createLinearGradient(0, 0, s, s);
    bg.addColorStop(0, '#13244a'); bg.addColorStop(1, '#0c1730');
    g.fillStyle = bg; g.fillRect(0, 0, s, s);
    // faint inner crosshatch
    g.strokeStyle = 'rgba(70,120,200,0.22)'; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath(); g.moveTo((i * s) / 4, 6); g.lineTo((i * s) / 4, s - 6); g.stroke();
      g.beginPath(); g.moveTo(6, (i * s) / 4); g.lineTo(s - 6, (i * s) / 4); g.stroke();
    }
    // bright neon border (the road edge that reads at a glance)
    const pad = 6, w = s - pad * 2;
    g.strokeStyle = '#5fe0ff'; g.lineWidth = 6; g.lineJoin = 'round';
    g.strokeRect(pad, pad, w, w);
    g.strokeStyle = 'rgba(150,245,255,0.55)'; g.lineWidth = 2;
    g.strokeRect(pad + 5, pad + 5, w - 10, w - 10);
    // corner nodes
    g.fillStyle = '#aef3ff';
    for (const [x, y] of [[pad, pad], [s - pad, pad], [pad, s - pad], [s - pad, s - pad]]) {
      g.beginPath(); g.arc(x, y, 3.4, 0, 6.3); g.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
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
