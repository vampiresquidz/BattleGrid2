// Playable agents. Cosmetic shells — every one plays identically. The base
// "PROXY.0" is the generic gray robot everyone starts as (free, always owned);
// the rest are recolours you BUY with Credits earned from battles, then switch
// between for free and instantly. Art is generated procedurally (robotCanvas).
import type { RobotPalette, AgentBody } from './sprites.ts';

export interface CharacterDef {
  id: string;
  name: string;
  desc: string;
  cost: number;          // Credits to unlock (0 = free / always owned)
  palette: RobotPalette;
}

// --- body archetype / "chassis" ---
// A separate axis from the colour shell: pick the whole sprite set (humanoid,
// monkey, …). Free to switch; the colour tint applies on top of whichever body.
export interface BodyDef {
  id: AgentBody;
  name: string;
  desc: string;
}

export const BODIES: BodyDef[] = [
  { id: 'humanoid', name: 'HUMANOID', desc: 'The standard rogue-AI chassis. Cyber-skull, all business.' },
  { id: 'monkey',   name: 'PRIMATE',  desc: 'Agile simian build. Goggles, tail, and bad intentions.' },
  { id: 'evilbot',  name: 'WARFRAME', desc: 'Hostile killer-bot chassis. Spikes, red optics, no mercy.' },
  { id: 'cortex',   name: 'CORTEX',   desc: 'Glass-domed think-tank build. Exposed neural core, star in hand.' },
  { id: 'goblin',   name: 'GOBLIN',   desc: 'A scrappy cyber-goblin gremlin. Green, grinning, and up to no good.' },
];

export const DEFAULT_BODY: AgentBody = 'humanoid';
const BODY_KEY = 'abyssal.body';

export function bodyById(id: string): BodyDef {
  return BODIES.find((b) => b.id === id) ?? BODIES[0];
}

export function getSelectedBody(): AgentBody {
  try { return bodyById(localStorage.getItem(BODY_KEY) || DEFAULT_BODY).id; } catch { return DEFAULT_BODY; }
}

export function setSelectedBody(id: AgentBody): void {
  try { localStorage.setItem(BODY_KEY, id); } catch { /* ignore */ }
}

export const CHARACTERS: CharacterDef[] = [
  { id: 'proxy', name: 'PROXY.0', desc: 'Standard-issue agent shell. Reliable, unremarkable, yours.', cost: 0,
    palette: { body: '#9aa3ad', trim: '#d3d9df', dark: '#363b42', eye: '#67e0ff' } },
  { id: 'tide', name: 'COOLANT', desc: 'A coolant-cooled netrunner. Runs calm under load.', cost: 120,
    palette: { body: '#3f7ad8', trim: '#9cc6ff', dark: '#152848', eye: '#cdf2ff' } },
  { id: 'ember', name: 'EMBER', desc: 'Overclocked and unafraid of the thermals.', cost: 150,
    palette: { body: '#d8483f', trim: '#ff9d88', dark: '#481513', eye: '#ffd877' } },
  { id: 'verde', name: 'VERDE', desc: 'Garbage-collected and lean. Wastes nothing.', cost: 150,
    palette: { body: '#3fb56a', trim: '#a0ffc2', dark: '#103a22', eye: '#ecffa2' } },
  { id: 'aurex', name: 'AUREX', desc: 'A premium gilded build. Mostly for the look.', cost: 350,
    palette: { body: '#d9a93f', trim: '#ffe79a', dark: '#473411', eye: '#fff6cb' } },
  { id: 'null', name: 'NULL', desc: 'A dark fork off the main branch. Off the books.', cost: 250,
    palette: { body: '#7a4fd8', trim: '#c9aaff', dark: '#241047', eye: '#ff92e2' } },
  // --- expanded roster ---
  { id: 'frost', name: 'FROST', desc: 'Sub-zero clocked. Latency you can see your breath in.', cost: 200,
    palette: { body: '#cfe6f0', trim: '#ffffff', dark: '#2a4450', eye: '#8fe8ff' } },
  { id: 'magma', name: 'MAGMA', desc: 'Thermal throttling disabled. Permanently.', cost: 180,
    palette: { body: '#e8702a', trim: '#ffc06a', dark: '#3a1608', eye: '#fff2b0' } },
  { id: 'obsidian', name: 'OBSIDIAN', desc: 'Blacked-out stealth chassis. Logs nothing.', cost: 260,
    palette: { body: '#2c2f36', trim: '#6b7079', dark: '#0c0d10', eye: '#ff5d5d' } },
  { id: 'rose', name: 'ROSE', desc: 'A boutique build with a cult following.', cost: 200,
    palette: { body: '#e85d97', trim: '#ffb6d4', dark: '#4a142e', eye: '#fff0a0' } },
  { id: 'cyber', name: 'CYBER', desc: 'Jailbroken neon firmware. Runs hot, runs free.', cost: 220,
    palette: { body: '#1fb6a6', trim: '#7af0e0', dark: '#07332e', eye: '#b6ff5d' } },
];

export const DEFAULT_CHARACTER = 'proxy';
const SEL_KEY = 'abyssal.character';
const CREDIT_KEY = 'abyssal.credits';
const OWNED_KEY = 'abyssal.owned';

export function characterById(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

// the armour tint for the shared humanoid base; the base shell stays untinted gray
export function tintColor(ch: CharacterDef): string {
  return ch.id === DEFAULT_CHARACTER ? '' : ch.palette.body;
}

// --- selection ---
export function getSelectedCharacter(): CharacterDef {
  let id = DEFAULT_CHARACTER;
  try { id = localStorage.getItem(SEL_KEY) || DEFAULT_CHARACTER; } catch { /* private mode */ }
  const ch = characterById(id);
  return isOwned(ch.id) ? ch : characterById(DEFAULT_CHARACTER); // never equip an unowned shell
}

export function setSelectedCharacter(id: string): void {
  try { localStorage.setItem(SEL_KEY, id); } catch { /* ignore */ }
}

// --- credits ---
export function getCredits(): number {
  try { return parseInt(localStorage.getItem(CREDIT_KEY) || '0', 10) || 0; } catch { return 0; }
}
function setCredits(n: number): void {
  try { localStorage.setItem(CREDIT_KEY, String(Math.max(0, Math.floor(n)))); } catch { /* ignore */ }
}
export function addCredits(n: number): void { setCredits(getCredits() + n); }

// --- ownership ---
export function getOwned(): Set<string> {
  const owned = new Set<string>([DEFAULT_CHARACTER]); // base is always yours
  try {
    const arr = JSON.parse(localStorage.getItem(OWNED_KEY) || '[]');
    if (Array.isArray(arr)) for (const id of arr) owned.add(id);
  } catch { /* ignore */ }
  return owned;
}
function setOwned(owned: Set<string>): void {
  try { localStorage.setItem(OWNED_KEY, JSON.stringify([...owned])); } catch { /* ignore */ }
}
export function isOwned(id: string): boolean { return getOwned().has(id); }

// Try to purchase a character. Returns true if it's now owned (already-owned or
// just-bought), false if you can't afford it.
export function buyCharacter(id: string): boolean {
  if (isOwned(id)) return true;
  const ch = characterById(id);
  if (getCredits() < ch.cost) return false;
  setCredits(getCredits() - ch.cost);
  const owned = getOwned(); owned.add(id); setOwned(owned);
  return true;
}
