// Roguelike dungeon RUN STATE + procedural maze generation (pure logic, no Three.js).
//
// A "run" is one trip through a randomly generated maze: navigate corridors,
// step on loot to grab Credits, step on a process to fight it (the real
// BattleScene), and reach the far corner to face the boss. Win the boss → big
// reward + extraction; lose any fight → the run ends and you're ejected.
//
// The run lives at module scope (not in the scene) on purpose: every battle
// tears the DungeonScene down and rebuilds it on return, so the maze, cleared
// nodes, collected loot and explored tiles must survive here between scenes —
// the same reason the overworld keeps its progress in progress.ts.
import { ENEMY_COUNT, RAT_DUNGEON } from './battle.ts';

export type NodeKind = 'enemy' | 'loot' | 'boss';
export type DungeonTheme = 'net' | 'rat';

export interface DungeonNode {
  kind: NodeKind;
  enemyIndex?: number; // which ENEMY_ROSTER entry to fight (enemy/boss)
  reward?: number;     // ◈ Credits (loot) or bonus payout
  cleared?: boolean;
}

export interface DungeonRun {
  cw: number; ch: number;          // maze size in cells
  tw: number; th: number;          // tile grid size (2*cells+1)
  tiles: Uint8Array;               // tw*th: 1 = floor, 0 = wall
  nodes: Map<number, DungeonNode>; // key = tileKey(col,row) of room tiles
  visited: Set<number>;            // explored tiles (fog-of-war on the minimap)
  player: { col: number; row: number };
  start: { col: number; row: number };
  boss: { col: number; row: number };
  bossName: string;
  depth: number;                   // dungeon level (scales reward/difficulty)
  theme: DungeonTheme;             // 'net' = default Net look, 'rat' = the Warrens
  creditsLooted: number;           // ◈ grabbed this run (loot, not battle bounties)
  enemiesCleared: number;
  bossDown: boolean;
}

let run: DungeonRun | null = null;

export function getRun(): DungeonRun | null { return run; }
export function endDungeonRun(): void { run = null; }

export function tileKey(run: DungeonRun, col: number, row: number): number { return row * run.tw + col; }
export function isFloor(run: DungeonRun, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= run.tw || row >= run.th) return false;
  return run.tiles[row * run.tw + col] === 1;
}
export function nodeAt(run: DungeonRun, col: number, row: number): DungeonNode | undefined {
  const n = run.nodes.get(tileKey(run, col, row));
  return n && !n.cleared ? n : undefined;
}

const BOSS_NAMES = [
  'THE ROOT KERNEL', 'NULL SOVEREIGN', 'WARDEN.SYS', 'THE COMPILER',
  'OVERSEER-9', 'BLACK ICE', 'THE GARBAGE COLLECTOR', 'DAEMON PRIME',
];

const cellTile = (cx: number, cy: number): [number, number] => [2 * cx + 1, 2 * cy + 1];
const randInt = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(a: T[]): T => a[randInt(a.length)];

// Enemy roster indices by difficulty tier (deeper rooms → nastier processes).
// Clamped to whatever the roster actually has; the rat theme uses its own pools.
function poolFor(tier: number, theme: DungeonTheme): number[] {
  const tiers = theme === 'rat' ? RAT_DUNGEON.tiers : [[0, 1, 2], [3, 4, 5], [6, 7, 8, 9]];
  const t = tiers[Math.max(0, Math.min(tiers.length - 1, tier))].filter((i) => i >= 0 && i < ENEMY_COUNT);
  return t.length ? t : [0];
}

// Randomized DFS (recursive backtracker) → a perfect maze, then a light "braid"
// pass that opens a few extra walls so corridors loop instead of dead-ending
// everywhere (nicer to navigate).
function carve(cw: number, ch: number): { tw: number; th: number; tiles: Uint8Array } {
  const tw = cw * 2 + 1, th = ch * 2 + 1;
  const tiles = new Uint8Array(tw * th); // all wall
  const seen = new Array(cw * ch).fill(false);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const stack: Array<[number, number]> = [[0, 0]];
  seen[0] = true;
  tiles[1 * tw + 1] = 1;
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const opts: Array<[number, number, number, number]> = [];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && nx < cw && ny >= 0 && ny < ch && !seen[ny * cw + nx]) opts.push([nx, ny, dx, dy]);
    }
    if (!opts.length) { stack.pop(); continue; }
    const [nx, ny, dx, dy] = pick(opts);
    seen[ny * cw + nx] = true;
    tiles[(2 * ny + 1) * tw + (2 * nx + 1)] = 1;          // neighbour room
    tiles[(2 * cy + 1 + dy) * tw + (2 * cx + 1 + dx)] = 1; // wall between → corridor
    stack.push([nx, ny]);
  }
  // braid: knock out ~12% of the interior walls that separate two rooms
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= cw || ny >= ch) continue;
        const wx = 2 * cx + 1 + dx, wy = 2 * cy + 1 + dy;
        if (tiles[wy * tw + wx] === 0 && Math.random() < 0.12) tiles[wy * tw + wx] = 1;
      }
    }
  }
  return { tw, th, tiles };
}

// BFS over floor tiles from a start tile → distance map (−1 = unreachable).
function distances(tw: number, th: number, tiles: Uint8Array, sc: number, sr: number): Int32Array {
  const dist = new Int32Array(tw * th).fill(-1);
  const q: number[] = [sr * tw + sc];
  dist[sr * tw + sc] = 0;
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let h = 0; h < q.length; h++) {
    const k = q[h], c = k % tw, r = (k / tw) | 0;
    for (const [dx, dy] of steps) {
      const nc = c + dx, nr = r + dy;
      if (nc < 0 || nr < 0 || nc >= tw || nr >= th) continue;
      const nk = nr * tw + nc;
      if (tiles[nk] === 1 && dist[nk] < 0) { dist[nk] = dist[k] + 1; q.push(nk); }
    }
  }
  return dist;
}

// Generate a fresh maze and stock it. depth lightly scales size/reward.
export function startDungeonRun(depth = 1, theme: DungeonTheme = 'net'): DungeonRun {
  const cw = 6 + Math.min(2, depth - 1);
  const ch = 6 + Math.min(2, depth - 1);
  const { tw, th, tiles } = carve(cw, ch);

  const [scol, srow] = cellTile(0, 0);
  const [bcol, brow] = cellTile(cw - 1, ch - 1);
  const dist = distances(tw, th, tiles, scol, srow);
  let maxD = 1;
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    const [c, r] = cellTile(cx, cy);
    maxD = Math.max(maxD, dist[r * tw + c]);
  }

  const nodes = new Map<number, DungeonNode>();
  const startK = srow * tw + scol, bossK = brow * tw + bcol;
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const [c, r] = cellTile(cx, cy);
      const k = r * tw + c;
      if (k === startK || k === bossK) continue;
      const tier = Math.max(0, Math.min(2, Math.floor((dist[k] / maxD) * 2.999)));
      const roll = Math.random();
      if (roll < 0.4) {
        nodes.set(k, { kind: 'enemy', enemyIndex: pick(poolFor(tier, theme)) });
      } else if (roll < 0.66) {
        nodes.set(k, { kind: 'loot', reward: 25 + tier * 35 + randInt(4) * 10 + (depth - 1) * 20 });
      }
    }
  }
  // boss: a top-tier process with a big bounty (themed for special dungeons)
  const bossIdx = theme === 'rat' && RAT_DUNGEON.boss >= 0
    ? RAT_DUNGEON.boss
    : (ENEMY_COUNT > 1 ? Math.max(0, ENEMY_COUNT - 1 - randInt(2)) : 0);
  nodes.set(bossK, { kind: 'boss', enemyIndex: bossIdx, reward: 300 + depth * 150 });

  run = {
    cw, ch, tw, th, tiles, nodes,
    visited: new Set<number>([startK]),
    player: { col: scol, row: srow },
    start: { col: scol, row: srow },
    boss: { col: bcol, row: brow },
    bossName: theme === 'rat' ? RAT_DUNGEON.bossName : pick(BOSS_NAMES),
    depth, theme,
    creditsLooted: 0,
    enemiesCleared: 0,
    bossDown: false,
  };
  return run;
}

// Mark whichever node the player just stepped onto as cleared (call before the
// battle hands off — win keeps it cleared, loss ends the run anyway).
export function clearNodeAt(col: number, row: number): DungeonNode | undefined {
  if (!run) return undefined;
  const n = run.nodes.get(tileKey(run, col, row));
  if (n) n.cleared = true;
  return n;
}

export interface DungeonSummary {
  cleared: boolean; depth: number; creditsLooted: number; enemiesCleared: number; bossName: string;
}
export function summary(cleared: boolean): DungeonSummary {
  return {
    cleared,
    depth: run?.depth ?? 1,
    creditsLooted: run?.creditsLooted ?? 0,
    enemiesCleared: run?.enemiesCleared ?? 0,
    bossName: run?.bossName ?? '???',
  };
}
