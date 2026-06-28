import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { textures, orbTexture, humanoidTexture } from './sprites.ts';
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
const WALL_H = 2.7;

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
    // fog far must clear the camera→floor distance (~20u) or the whole maze reads
    // black; keep near maze crisp, only the deep maze fades into the dark.
    this.scene.fog = new THREE.Fog(0x06060f, TILE * 6, TILE * 17);
    this.scene.background = new THREE.Color(0x06060f);

    this.scene.add(new THREE.AmbientLight(0x46527e, 1.35));
    // torch on the player — pools warm light on nearby tiles (dungeon mood)
    this.torch = new THREE.PointLight(0xcfe6ff, 60, TILE * 11, 1.4);
    this.torch.position.set(0, 5, 0);
    this.scene.add(this.torch);
    const fill = new THREE.DirectionalLight(0xa79bff, 0.6);
    fill.position.set(-4, 12, 6);
    this.scene.add(fill);

    // ---- floor + wall instanced meshes ----
    const run = this.run;
    const floorIdx: number[] = [];
    const wallIdx: number[] = [];
    for (let r = 0; r < run.th; r++) {
      for (let c = 0; c < run.tw; c++) {
        if (run.tiles[r * run.tw + c] === 1) { floorIdx.push(r * run.tw + c); continue; }
        // a wall tile is drawn only if it borders a floor tile (carves the look)
        let border = false;
        for (let dr = -1; dr <= 1 && !border; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const nc = c + dc, nr = r + dr;
            if (nc >= 0 && nr >= 0 && nc < run.tw && nr < run.th && run.tiles[nr * run.tw + nc] === 1) { border = true; break; }
          }
        if (border) wallIdx.push(r * run.tw + c);
      }
    }

    const floorTex = textures.alienGround();
    floorTex.colorSpace = THREE.SRGBColorSpace;
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex, emissiveMap: floorTex, emissive: 0x2c50c0, emissiveIntensity: 0.7,
      color: 0x7884b8, roughness: 1, metalness: 0.05,
    });
    const floorGeo = new THREE.BoxGeometry(TILE, 0.3, TILE);
    const floor = new THREE.InstancedMesh(floorGeo, floorMat, floorIdx.length);
    const m = new THREE.Matrix4();
    floorIdx.forEach((k, i) => {
      const c = k % run.tw, r = (k / run.tw) | 0;
      m.makeTranslation(this.wx(c), -0.15, this.wz(r));
      floor.setMatrixAt(i, m);
    });
    floor.instanceMatrix.needsUpdate = true;
    this.scene.add(floor);

    const cliffTex = textures.alienCliff();
    cliffTex.colorSpace = THREE.SRGBColorSpace;
    const wallMat = new THREE.MeshStandardMaterial({
      map: cliffTex, emissiveMap: cliffTex, emissive: 0x7a4aff, emissiveIntensity: 0.6,
      color: 0x3a3360, roughness: 1,
    });
    const wallGeo = new THREE.BoxGeometry(TILE, WALL_H, TILE);
    const wall = new THREE.InstancedMesh(wallGeo, wallMat, wallIdx.length);
    wallIdx.forEach((k, i) => {
      const c = k % run.tw, r = (k / run.tw) | 0;
      m.makeTranslation(this.wx(c), WALL_H / 2 - 0.1, this.wz(r));
      wall.setMatrixAt(i, m);
    });
    wall.instanceMatrix.needsUpdate = true;
    this.scene.add(wall);

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
    this.player = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dirTex.down, transparent: true }));
    this.player.scale.set(3.0, 3.0, 1);
    this.scene.add(this.player);
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
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.55, 0.6,
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
