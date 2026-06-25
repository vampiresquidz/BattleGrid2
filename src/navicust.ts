// NaviCust — passive "programs" you install against a MEMORY budget, a second
// build axis layered on top of your chip deck (MMBN NaviCustomizer). The budget
// grows as you win battles, so program slots are earned. Equipped set persists
// globally in localStorage; the battle reads the aggregated effects at start.
import { getWins } from './progress.ts';
import type { ChipKind } from './chips.ts';

export interface ProgramEffect {
  hp?: number;            // +max integrity
  ram?: number;           // +RAM every Custom window
  customSpeed?: number;   // +fraction faster Custom gauge fill
  charge?: number;        // +fraction faster buster charge
  regen?: number;         // integrity regenerated per second
  openingChip?: ChipKind; // a free chip pre-queued at battle start
}
export interface Program {
  id: string; name: string; icon: string; mem: number; desc: string; effect: ProgramEffect;
}

export const PROGRAMS: Program[] = [
  { id: 'hardmem',  name: 'HardMem',      icon: '❤️', mem: 2, desc: '+40 max integrity.',                 effect: { hp: 40 } },
  { id: 'megamem',  name: 'MegaMem',      icon: '💗', mem: 4, desc: '+90 max integrity.',                 effect: { hp: 90 } },
  { id: 'turbo',    name: 'Turbo Clock',  icon: '⏩', mem: 3, desc: 'Custom gauge fills 25% faster.',      effect: { customSpeed: 0.25 } },
  { id: 'rapidchg', name: 'Rapid Charge', icon: '⚡', mem: 2, desc: 'Buster charges 30% faster.',          effect: { charge: 0.30 } },
  { id: 'extram',   name: 'Extra RAM',    icon: '🧠', mem: 4, desc: '+1 RAM in every Custom window.',      effect: { ram: 1 } },
  { id: 'selfrepair', name: 'Self-Repair',icon: '🔧', mem: 3, desc: 'Regenerate 4 integrity per second.',  effect: { regen: 4 } },
  { id: 'quickdraw', name: 'Quick Draw',  icon: '🃏', mem: 3, desc: 'Start each battle with a Logic Bolt queued.', effect: { openingChip: 'cannon' } },
  { id: 'firstaid', name: 'First Aid',    icon: '🩹', mem: 2, desc: 'Start each battle with a Checkpoint queued.',  effect: { openingChip: 'recover' } },
];

// Memory budget: starts at 6, +1 per 2 wins, capped at 16.
export function memBudget(): number { return Math.min(16, 6 + Math.floor(getWins() / 2)); }

const KEY = 'abyssal.navicust';
export function getEquipped(): string[] {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(a) ? a.filter((x) => PROGRAMS.some((p) => p.id === x)) : [];
  } catch { return []; }
}
function setEquipped(ids: string[]): void { try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* ignore */ } }

export function memUsed(ids: string[] = getEquipped()): number {
  return ids.reduce((s, id) => s + (PROGRAMS.find((p) => p.id === id)?.mem ?? 0), 0);
}

// Toggle a program on/off. Returns false if it won't fit the budget.
export function toggleProgram(id: string): boolean {
  const eq = getEquipped();
  if (eq.includes(id)) { setEquipped(eq.filter((x) => x !== id)); return true; }
  const p = PROGRAMS.find((x) => x.id === id);
  if (!p || memUsed(eq) + p.mem > memBudget()) return false;
  setEquipped([...eq, id]);
  return true;
}

export interface AggregatedEffects {
  hp: number; ram: number; customSpeed: number; charge: number; regen: number; openingChip?: ChipKind;
}
export function equippedEffects(): AggregatedEffects {
  const out: AggregatedEffects = { hp: 0, ram: 0, customSpeed: 0, charge: 0, regen: 0, openingChip: undefined };
  for (const id of getEquipped()) {
    const e = PROGRAMS.find((p) => p.id === id)?.effect;
    if (!e) continue;
    out.hp += e.hp ?? 0; out.ram += e.ram ?? 0; out.customSpeed += e.customSpeed ?? 0;
    out.charge += e.charge ?? 0; out.regen += e.regen ?? 0;
    if (e.openingChip) out.openingChip = e.openingChip;
  }
  return out;
}
