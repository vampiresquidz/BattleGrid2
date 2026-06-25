// Chip system, MMBN-style.
//
// A "folder" is your deck (here: 30 chips). At the start of battle and each time
// the Custom gauge fills, you draw a HAND of up to 5 from the top of the shuffled
// folder. You may pick multiple chips only if they share the same NAME or the same
// letter CODE (the classic Battle Network rule). Picked chips queue up and you fire
// them one at a time during the real-time phase.

export type ChipKind =
  | 'cannon' | 'sword' | 'shotgun' | 'bomb' | 'recover' | 'grab'
  | 'guard' | 'lance' | 'mine' | 'wind' | 'overclock'
  | 'vulcan' | 'drain' | 'blink' | 'quake' | 'megaheal' | 'flamecannon' | 'minibomb'
  | 'cluster' | 'wsword' | 'gatling' | 'water' | 'volcano'
  | 'freeze' | 'mark' | 'amp' | 'aura' | 'riptide' | 'slow' | 'cleanse'
  // --- tech / recounter wave (deck-building meta) ---
  | 'emp' | 'reflect' | 'jam' | 'bulwark' | 'shatter' | 'leech' | 'phase' | 'forkbomb';

// The counter-triangle class drives the game-theory reads:
//   strike  → beaten by GUARD (blocked + countered)
//   guard   → beaten by BREACH (pierces/ignores barriers & position)
//   breach  → slow/committal, beaten by fast STRIKE tempo
// control = zoning/displacement, tempo = action economy, support = sustain.
export type ChipClass = 'strike' | 'guard' | 'breach' | 'control' | 'tempo' | 'support';

export interface Chip {
  id: string;          // unique per copy in the folder
  name: string;        // display name
  code: string;        // letter code A-Z or '*' (wildcard, combines with anything)
  kind: ChipKind;
  cls: ChipClass;
  damage: number;
  cost: number;        // RAM spent to queue this chip in a Custom turn
  icon: string;        // emoji placeholder
  desc: string;
}

export interface ChipDef {
  name: string;
  kind: ChipKind;
  cls: ChipClass;
  damage: number;
  cost: number;
  icon: string;
  desc: string;
}

// AI-agent / compute theme: the player & foes are agents, panels are "nodes",
// HP is "integrity", attacks are ops/exploits, enemy columns are data centers.
export const CHIP_DEFS: Record<ChipKind, ChipDef> = {
  cannon:    { name: 'Logic Bolt',  kind: 'cannon',    cls: 'strike',  damage: 40,  cost: 2, icon: '💥', desc: 'Fires a token bolt at the first process in your row.' },
  sword:     { name: 'Backprop',    kind: 'sword',     cls: 'strike',  damage: 80,  cost: 3, icon: '🗡️', desc: 'Slashes the node directly ahead.' },
  shotgun:   { name: 'Dropout',     kind: 'shotgun',   cls: 'strike',  damage: 30,  cost: 1, icon: '🔫', desc: 'Scatters: hits ahead + the node behind.' },
  bomb:      { name: 'Kernel Panic',kind: 'bomb',      cls: 'breach',  damage: 60,  cost: 3, icon: '💣', desc: 'Lobbed 3 nodes ahead, splash 1.' },
  recover:   { name: 'Checkpoint',  kind: 'recover',   cls: 'support', damage: 60,  cost: 2, icon: '💚', desc: 'Restores integrity instead of attacking.' },
  grab:      { name: 'Provision',   kind: 'grab',      cls: 'breach',  damage: 0,   cost: 4, icon: '🗄️', desc: 'Seize the front enemy data-center column.' },
  // --- game-theory wave ---
  guard:     { name: 'Firewall',    kind: 'guard',     cls: 'guard',   damage: 60,  cost: 2, icon: '🛡️', desc: 'Barrier ~3s: blocks the next hit and counters.' },
  lance:     { name: 'Zero-Day',    kind: 'lance',     cls: 'breach',  damage: 100, cost: 4, icon: '🔱', desc: 'Pierces the WHOLE row, through firewalls.' },
  mine:      { name: 'Honeypot',    kind: 'mine',      cls: 'control', damage: 90,  cost: 3, icon: '🍯', desc: 'Plant a trap ahead; agents route around it.' },
  wind:      { name: 'Rate Limit',  kind: 'wind',      cls: 'control', damage: 10,  cost: 1, icon: '🌀', desc: 'Throttle the enemy back a column.' },
  overclock: { name: 'Overclock',   kind: 'overclock', cls: 'tempo',   damage: 0,   cost: 2, icon: '⚡', desc: 'Refill Compute now — but corrupts your node.' },
  // --- expanded item set ---
  vulcan:    { name: 'Batch Infer', kind: 'vulcan',     cls: 'strike',  damage: 18,  cost: 2, icon: '🔩', desc: 'Rapid 3-token burst down your row.' },
  drain:     { name: 'Web Scrape',  kind: 'drain',      cls: 'strike',  damage: 50,  cost: 3, icon: '🩸', desc: 'Shot that restores you for half the hit.' },
  blink:     { name: 'Hot Swap',    kind: 'blink',      cls: 'control', damage: 0,   cost: 1, icon: '💨', desc: 'Migrate to your back line — dodge.' },
  quake:     { name: 'Cascade Fail',kind: 'quake',      cls: 'breach',  damage: 70,  cost: 3, icon: '🌋', desc: 'Cracks a wide zone ahead, through firewalls.' },
  megaheal:  { name: 'Snapshot',    kind: 'megaheal',   cls: 'support', damage: 140, cost: 4, icon: '💖', desc: 'Restores a large chunk of integrity.' },
  flamecannon:{ name: 'GPU Burn',   kind: 'flamecannon',cls: 'strike',  damage: 60,  cost: 2, icon: '🔥', desc: 'Heavier overheating bolt down your row.' },
  minibomb:  { name: 'Mem Leak',    kind: 'minibomb',   cls: 'breach',  damage: 35,  cost: 1, icon: '🎇', desc: 'Cheap lobbed packet, small splash.' },
  cluster:   { name: 'GPU Cluster', kind: 'cluster',    cls: 'strike',  damage: 34,  cost: 4, icon: '🖥️', desc: 'Parallel beams down three rows at once.' },
  // --- expanded chip set (wide melee / rapid fire / displacement / zoning) ---
  wsword:    { name: 'Tensor Slash',kind: 'wsword',     cls: 'strike',  damage: 75,  cost: 3, icon: '⚔️', desc: 'Wide slash: the node ahead and the two beside it.' },
  gatling:   { name: 'Token Stream',kind: 'gatling',    cls: 'tempo',   damage: 14,  cost: 3, icon: '🪙', desc: 'Rapid 6-token barrage straight down your row.' },
  water:     { name: 'Cache Flush', kind: 'water',      cls: 'control', damage: 50,  cost: 2, icon: '💧', desc: 'Pressurized blast — damages and shoves the enemy back.' },
  volcano:   { name: 'Thermal Run', kind: 'volcano',    cls: 'control', damage: 25,  cost: 3, icon: '🌋', desc: 'Ignite a node ahead; it scorches anyone on it each tick.' },
  // --- setup / synergy chips (build-around archetypes) ---
  freeze:    { name: 'Deadlock',    kind: 'freeze',     cls: 'control', damage: 20,  cost: 3, icon: '🧊', desc: 'Lock the enemy in place 1.6s — slow ops can\'t be dodged.' },
  mark:      { name: 'Exploit Tag', kind: 'mark',       cls: 'control', damage: 10,  cost: 2, icon: '🎯', desc: 'Tag the target: it takes +50% from your hits for 4s.' },
  amp:       { name: 'Overdrive',   kind: 'amp',        cls: 'tempo',   damage: 0,   cost: 2, icon: '🔆', desc: 'Supercharge your NEXT op for +80% damage.' },
  aura:      { name: 'Sentinel',    kind: 'aura',       cls: 'guard',   damage: 80,  cost: 3, icon: '🧿', desc: 'Aura soaks up to 80 incoming damage over 5s.' },
  riptide:   { name: 'Backpressure',kind: 'riptide',    cls: 'strike',  damage: 40,  cost: 3, icon: '🌊', desc: 'Row shot; +40 vs an enemy pinned to its back columns.' },
  slow:      { name: 'Throttle Core',kind: 'slow',      cls: 'tempo',   damage: 10,  cost: 3, icon: '🐌', desc: 'Halve the enemy\'s action speed for 4s — out-tempo it.' },
  cleanse:   { name: 'Rollback',    kind: 'cleanse',    cls: 'support', damage: 0,   cost: 2, icon: '🧹', desc: 'Purge your debuffs and resist new ones for 3s.' },
  // --- tech / recounter wave: deck-building answers to whole archetypes ---
  emp:       { name: 'EMP Spike',   kind: 'emp',        cls: 'control', damage: 20,  cost: 3, icon: '📡', desc: 'Strip the foe\'s buffs (shield/aura/overdrive) + chip damage. Counters combo & defense.' },
  reflect:   { name: 'Mirror Shield',kind: 'reflect',   cls: 'guard',   damage: 0,   cost: 3, icon: '🪞', desc: 'For 2.5s, reflect the next hit back at 1.5×. Punishes aggro.' },
  jam:       { name: 'Throughput Choke',kind: 'jam',    cls: 'control', damage: 10,  cost: 2, icon: '🚧', desc: 'Damage + drain the foe\'s Custom gauge. Denies combo/control setup.' },
  bulwark:   { name: 'Hardened Runtime',kind: 'bulwark',cls: 'guard',   damage: 160, cost: 4, icon: '🏰', desc: 'Aura soaks up to 160 over 6s — a wall against aggro.' },
  shatter:   { name: 'Stack Smash', kind: 'shatter',    cls: 'breach',  damage: 60,  cost: 3, icon: '🔨', desc: 'Pierces the row through guards; DOUBLE vs a shielded target.' },
  leech:     { name: 'Memory Harvest',kind: 'leech',    cls: 'strike',  damage: 60,  cost: 4, icon: '🧛', desc: 'Heavy shot that heals you for the full damage dealt.' },
  phase:     { name: 'Sandbox',     kind: 'phase',      cls: 'control', damage: 0,   cost: 2, icon: '👻', desc: 'Phase out ~1s: ignore all damage. Dodges burst & combos.' },
  forkbomb:  { name: 'Fork Bomb',   kind: 'forkbomb',   cls: 'breach',  damage: 45,  cost: 4, icon: '🧨', desc: 'Carpet the foe\'s entire back line, through guards. Punishes turtling.' },
};

let uid = 0;
function makeChip(kind: ChipKind, code: string): Chip {
  const d = CHIP_DEFS[kind];
  return { id: `${kind}-${uid++}`, name: d.name, code, kind, cls: d.cls, damage: d.damage, cost: d.cost, icon: d.icon, desc: d.desc };
}

// ---------------- Deck building ----------------
// A deck is an ORDERED list of {kind, code} entries. The battle shuffles it into
// the draw pile. Codes still matter: matching NAME or CODE gives the combo
// discount in the Custom window, so code-planning is part of the strategy.
export interface DeckEntry { kind: ChipKind; code: string }
export const DECK_SIZE = 30;          // a legal deck is exactly this many chips
export const MAX_COPIES = 4;          // ...with at most this many of any one chip
export const CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'K', 'L', 'N', 'O', 'Q', 'R', 'S', 'T', 'V', 'W', '*'];
export const ALL_CHIP_KINDS = Object.keys(CHIP_DEFS) as ChipKind[];

// A balanced 30-card default deck (midrange: strike core + a little defense,
// control, and combo so new players see every lever). Codes are pre-tuned for
// combo discounts (S sword package, B/T breach, R sustain, D defense, I control).
const DEFAULT_RECIPE: Array<[ChipKind, string, number]> = [
  ['cannon', 'A', 3],
  ['cannon', '*', 1],
  ['shotgun', 'A', 3],
  ['sword', 'S', 3],
  ['wsword', 'S', 2],     // combos with Sword (code S)
  ['bomb', 'B', 3],
  ['lance', 'B', 2],      // combos with Bomb (code B)
  ['recover', 'R', 3],
  ['megaheal', 'R', 1],   // combos with Checkpoint (code R)
  ['guard', 'D', 2],
  ['aura', 'D', 1],       // combos with Firewall (code D)
  ['vulcan', 'V', 2],
  ['drain', 'N', 1],
  ['mark', 'I', 1],
  ['amp', 'O', 1],
  ['blink', 'K', 1],
];

function recipeToDeck(recipe: Array<[ChipKind, string, number]>): DeckEntry[] {
  const out: DeckEntry[] = [];
  for (const [kind, code, n] of recipe) for (let i = 0; i < n; i++) out.push({ kind, code });
  return out;
}

export function defaultDeck(): DeckEntry[] { return recipeToDeck(DEFAULT_RECIPE); }

export function deckToChips(deck: DeckEntry[]): Chip[] {
  return deck.filter((e) => CHIP_DEFS[e.kind]).map((e) => makeChip(e.kind, e.code));
}

// max copies of a given chip KIND allowed in a legal deck
export function copiesOf(deck: DeckEntry[], kind: ChipKind): number {
  return deck.filter((e) => e.kind === kind).length;
}

export function validateDeck(deck: DeckEntry[]): { ok: boolean; msg: string } {
  if (deck.length !== DECK_SIZE) return { ok: false, msg: `Deck must be exactly ${DECK_SIZE} chips (have ${deck.length}).` };
  for (const k of ALL_CHIP_KINDS) {
    if (copiesOf(deck, k) > MAX_COPIES) return { ok: false, msg: `Too many ${CHIP_DEFS[k].name} (max ${MAX_COPIES}).` };
  }
  return { ok: true, msg: 'Legal deck.' };
}

// --- persistence ---
const DECK_KEY = 'abyssal.deck';
export function getDeck(): DeckEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DECK_KEY) || 'null');
    if (Array.isArray(raw) && raw.length && raw.every((e) => e && CHIP_DEFS[e.kind as ChipKind] && typeof e.code === 'string')) {
      return raw.map((e) => ({ kind: e.kind as ChipKind, code: e.code as string }));
    }
  } catch { /* fall through */ }
  return defaultDeck();
}
export function setDeck(deck: DeckEntry[]): void {
  try { localStorage.setItem(DECK_KEY, JSON.stringify(deck)); } catch { /* ignore */ }
}

// The battle draw pile = the player's saved deck (or the default).
export function buildStarterFolder(): Chip[] {
  return deckToChips(getDeck());
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Does `candidate` combo with any already-selected chip (same NAME or CODE,
// '*' wildcard matches any)? Used for the RAM cost discount.
export function comboMatch(selected: Chip[], candidate: Chip): boolean {
  return selected.some((c) =>
    c !== candidate && (
      c.name === candidate.name ||
      c.code === candidate.code ||
      c.code === '*' || candidate.code === '*'
    ));
}

// Given a set of already-selected chips, can `candidate` also be selected?
// Rule: all selected chips must share one common name OR one common code.
// Wildcard '*' code matches any code. (Legacy — kept for reference.)
export function canSelectTogether(selected: Chip[], candidate: Chip): boolean {
  if (selected.length === 0) return true;
  const all = [...selected, candidate];

  const sameName = all.every((c) => c.name === all[0].name);
  if (sameName) return true;

  // Find a code shared by all (treating '*' as compatible with everything).
  const codes = all.map((c) => c.code);
  const concrete = codes.filter((c) => c !== '*');
  const sameCode = concrete.length === 0 || concrete.every((c) => c === concrete[0]);
  return sameCode;
}
