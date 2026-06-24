// Persistent overworld progress. The overworld scene is torn down and rebuilt
// after every encounter battle, so anything that should survive (collected
// shards, looted caches, discovered beacons, quest state, last position) lives
// here in localStorage rather than on the scene instance. All keys: abyssal.ow.*

const SHARDS = 'abyssal.ow.shards';     // JSON int[] of collected shard indices
const CACHES = 'abyssal.ow.caches';     // JSON int[] of looted cache indices
const BEACONS = 'abyssal.ow.beacons';   // JSON int[] of discovered beacon indices
const WINS = 'abyssal.ow.wins';         // total encounter battles won (number)
const QUEST = 'abyssal.ow.quest';       // quest stage: 0 unoffered, 1 active, 2 done
const QUEST_BASE = 'abyssal.ow.questBaseWins'; // wins tally when the quest started
const POS = 'abyssal.ow.pos';           // {x,z} last overworld position

function getSet(key: string): Set<number> {
  try {
    const a = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set<number>(Array.isArray(a) ? a : []);
  } catch { return new Set(); }
}
function addToSet(key: string, i: number): void {
  try { const s = getSet(key); s.add(i); localStorage.setItem(key, JSON.stringify([...s])); } catch { /* ignore */ }
}
function getNum(key: string): number {
  try { return parseInt(localStorage.getItem(key) || '0', 10) || 0; } catch { return 0; }
}
function setNum(key: string, n: number): void {
  try { localStorage.setItem(key, String(n)); } catch { /* ignore */ }
}

export const getShards = () => getSet(SHARDS);
export const collectShard = (i: number) => addToSet(SHARDS, i);
export const getCaches = () => getSet(CACHES);
export const lootCache = (i: number) => addToSet(CACHES, i);
export const getBeacons = () => getSet(BEACONS);
export const discoverBeacon = (i: number) => addToSet(BEACONS, i);

export const getWins = () => getNum(WINS);
export const addWin = () => setNum(WINS, getWins() + 1);

export const getQuestStage = () => getNum(QUEST);
export const setQuestStage = (s: number) => setNum(QUEST, s);
export const getQuestBaseWins = () => getNum(QUEST_BASE);
export const setQuestBaseWins = (n: number) => setNum(QUEST_BASE, n);

export function getPos(): { x: number; z: number } | null {
  try {
    const p = JSON.parse(localStorage.getItem(POS) || 'null');
    return p && typeof p.x === 'number' && typeof p.z === 'number' ? p : null;
  } catch { return null; }
}
export function savePos(x: number, z: number): void {
  try { localStorage.setItem(POS, JSON.stringify({ x, z })); } catch { /* ignore */ }
}
