import * as THREE from 'three';
import { panelTextures, panelCrackedTextures } from './sprites.ts';

export type Owner = 'player' | 'enemy';
export type Status = 'normal' | 'cracked' | 'broken';

interface Cell {
  top: THREE.Mesh;
  body: THREE.Mesh;
  owner: Owner;
  status: Status;
  regen: number; // seconds until a broken panel heals
}

const BROKEN_REGEN = 8;
const BODY_Y = 0;
const TOP_Y = 0.142;

// Manages the battle grid: per-tile ownership (for AreaGrab), and the
// normal -> cracked -> broken -> (regen) lifecycle.
export class PanelGrid {
  private cells: Cell[][] = []; // [col][row]
  private divider: number; // number of left-most columns owned by the player

  // shared materials
  private playerTop: THREE.Material;
  private enemyTop: THREE.Material;
  private crackedTop: THREE.Material;
  private playerBody: THREE.Material;
  private enemyBody: THREE.Material;
  private brokenBody: THREE.Material;

  constructor(
    scene: THREE.Scene,
    private cols: number,
    private rows: number,
    colX: (c: number) => number,
    rowZ: (r: number) => number,
    tileW: number,
    tileD: number,
    playerCols: number[],
  ) {
    this.divider = playerCols.length;

    const pTex = panelTextures(true);
    const eTex = panelTextures(false);
    const cTex = panelCrackedTextures();
    const mkTop = (t: typeof pTex, glow: number) => new THREE.MeshStandardMaterial({
      map: t.map, emissive: 0xffffff, emissiveMap: t.emissive, emissiveIntensity: glow,
      roughness: 0.55, metalness: 0.2,
    });
    this.playerTop = mkTop(pTex, 1.2);
    this.enemyTop = mkTop(eTex, 1.2);
    this.crackedTop = mkTop(cTex, 0.8);
    this.playerBody = new THREE.MeshStandardMaterial({ color: 0x0c2228, roughness: 0.85 });
    this.enemyBody = new THREE.MeshStandardMaterial({ color: 0x180820, roughness: 0.85 });
    this.brokenBody = new THREE.MeshStandardMaterial({ color: 0x05080a, roughness: 1 });

    const bodyGeo = new THREE.BoxGeometry(tileW * 0.92, 0.28, tileD * 0.92);
    const topGeo = new THREE.PlaneGeometry(tileW * 0.92, tileD * 0.92);

    for (let c = 0; c < cols; c++) {
      this.cells[c] = [];
      for (let r = 0; r < rows; r++) {
        const owner: Owner = playerCols.includes(c) ? 'player' : 'enemy';
        const body = new THREE.Mesh(bodyGeo, owner === 'player' ? this.playerBody : this.enemyBody);
        body.position.set(colX(c), BODY_Y, rowZ(r));
        body.receiveShadow = true;
        scene.add(body);

        const top = new THREE.Mesh(topGeo, owner === 'player' ? this.playerTop : this.enemyTop);
        top.rotation.x = -Math.PI / 2;
        top.position.set(colX(c), TOP_Y, rowZ(r));
        top.receiveShadow = true;
        scene.add(top);

        this.cells[c][r] = { top, body, owner, status: 'normal', regen: 0 };
      }
    }
  }

  owner(col: number, row: number): Owner | null {
    return this.cells[col]?.[row]?.owner ?? null;
  }

  canStand(col: number, row: number, who: Owner): boolean {
    const cell = this.cells[col]?.[row];
    return !!cell && cell.owner === who && cell.status !== 'broken';
  }

  // Call when an entity steps OFF a tile: cracked panels collapse behind them.
  leave(col: number, row: number) {
    const cell = this.cells[col]?.[row];
    if (cell && cell.status === 'cracked') this.setBroken(cell);
  }

  // Damage a panel: normal -> cracked, cracked -> broken.
  crack(col: number, row: number) {
    const cell = this.cells[col]?.[row];
    if (!cell) return;
    if (cell.status === 'normal') {
      cell.status = 'cracked';
      cell.top.material = this.crackedTop;
    } else if (cell.status === 'cracked') {
      this.setBroken(cell);
    }
  }

  private setBroken(cell: Cell) {
    cell.status = 'broken';
    cell.regen = BROKEN_REGEN;
    cell.top.visible = false;
    cell.body.position.y = BODY_Y - 0.22; // sink
    cell.body.material = this.brokenBody;
  }

  private restore(cell: Cell) {
    cell.status = 'normal';
    cell.top.visible = true;
    cell.top.material = cell.owner === 'player' ? this.playerTop : this.enemyTop;
    cell.body.position.y = BODY_Y;
    cell.body.material = cell.owner === 'player' ? this.playerBody : this.enemyBody;
  }

  private setOwner(cell: Cell, owner: Owner) {
    cell.owner = owner;
    if (cell.status !== 'broken') {
      cell.top.material = cell.status === 'cracked' ? this.crackedTop
        : owner === 'player' ? this.playerTop : this.enemyTop;
      cell.body.material = owner === 'player' ? this.playerBody : this.enemyBody;
    }
  }

  // AreaGrab: steal the front-most enemy column for the player. Returns the
  // stolen column index, or -1 if the player already owns the whole board.
  grabForPlayer(): number {
    if (this.divider >= this.cols) return -1;
    const col = this.divider;
    for (let r = 0; r < this.rows; r++) this.setOwner(this.cells[col][r], 'player');
    this.divider++;
    return col;
  }

  // Enemy steals a column back from the player.
  grabForEnemy(): number {
    if (this.divider <= 1) return -1;
    const col = this.divider - 1;
    for (let r = 0; r < this.rows; r++) this.setOwner(this.cells[col][r], 'enemy');
    this.divider--;
    return col;
  }

  // Nearest tile in a side's territory for repositioning a knocked-out entity.
  anyStandable(who: Owner, preferRow: number): { col: number; row: number } | null {
    const cols = who === 'player'
      ? Array.from({ length: this.divider }, (_, i) => i)
      : Array.from({ length: this.cols - this.divider }, (_, i) => this.cols - 1 - i);
    const rowOrder = [preferRow, ...Array.from({ length: this.rows }, (_, i) => i)];
    for (const c of cols) for (const r of rowOrder) {
      if (this.canStand(c, r, who)) return { col: c, row: r };
    }
    return null;
  }

  update(dt: number) {
    for (const col of this.cells) for (const cell of col) {
      if (cell.status === 'broken') {
        cell.regen -= dt;
        if (cell.regen <= 0) this.restore(cell);
      }
    }
  }
}
