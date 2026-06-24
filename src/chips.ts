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
  | 'freeze' | 'mark' | 'amp' | 'aura' | 'riptide' | 'slow' | 'cleanse';

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
};

let uid = 0;
function makeChip(kind: ChipKind, code: string): Chip {
  const d = CHIP_DEFS[kind];
  return { id: `${kind}-${uid++}`, name: d.name, code, kind, cls: d.cls, damage: d.damage, cost: d.cost, icon: d.icon, desc: d.desc };
}

// A starter folder of 30 chips with assorted letter codes.
export function buildStarterFolder(): Chip[] {
  const recipe: Array<[ChipKind, string, number]> = [
    ['cannon', 'A', 4],
    ['cannon', 'B', 3],
    ['cannon', '*', 1],
    ['shotgun', 'A', 3],
    ['shotgun', 'C', 3],
    ['sword', 'S', 3],
    ['sword', 'L', 2],
    ['bomb', 'B', 3],
    ['bomb', 'T', 2],
    ['recover', 'R', 4],
    ['recover', '*', 2],
    ['grab', 'G', 2],
    // game-theory wave
    ['guard', 'D', 3],
    ['lance', 'L', 2],   // shares code L with Sword → combo discount
    ['mine', 'T', 2],    // shares code T with Bomb
    ['wind', 'W', 2],
    ['overclock', 'O', 2],
    // expanded items
    ['vulcan', 'V', 3],
    ['drain', 'N', 2],
    ['blink', 'K', 2],
    ['quake', 'Q', 2],
    ['megaheal', 'R', 2],     // shares code R with Checkpoint
    ['flamecannon', 'F', 2],
    ['minibomb', 'T', 2],     // shares code T with Kernel Panic / Honeypot
    ['cluster', 'G', 1],      // shares code G with Provision
    // expanded chip set
    ['wsword', 'S', 2],       // shares code S with Sword
    ['gatling', 'V', 2],      // shares code V with Batch Infer
    ['water', 'W', 2],        // shares code W with Rate Limit
    ['volcano', 'F', 2],      // shares code F with GPU Burn
    // setup / synergy chips — codes group them into build-around packages:
    ['freeze', 'I', 2],       // I = lockdown package (Deadlock + Exploit Tag)
    ['mark', 'I', 2],         // shares I with Deadlock → control combo discount
    ['amp', 'O', 2],          // O = tempo/buff package (shares with Overclock)
    ['aura', 'D', 2],         // D = defense package (shares with Firewall)
    ['riptide', 'W', 2],      // W = water/displacement package (Cache Flush / Rate Limit)
    ['slow', 'O', 1],         // shares O with Overdrive / Overclock
    ['cleanse', 'R', 2],      // R = support package (Checkpoint / Snapshot) → counter to debuffs
  ];
  const folder: Chip[] = [];
  for (const [kind, code, count] of recipe) {
    for (let i = 0; i < count; i++) folder.push(makeChip(kind, code));
  }
  return folder;
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
