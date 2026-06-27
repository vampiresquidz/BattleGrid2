// Guest mode: play without a Phantom wallet. All persistence is redirected to an
// in-memory store, so NOTHING is saved — credits, ◊ TIDE, decks, unlocks and
// cosmetics all reset when the tab closes. Every game module reads/writes through
// `localStorage`, so swapping it for an in-memory shim makes the whole session
// ephemeral with no per-module changes.
import type { Session } from './wallet.ts';

export const GUEST_SESSION: Session = { address: 'guest', short: 'Guest', signature: '' };

let active = false;
export function isGuest(): boolean { return active; }

// Seed a fresh guest with enough to actually try the loops (not saved).
function seed(): Map<string, string> {
  return new Map<string, string>([
    ['abyssal.credits', '500'],
    ['abyssal.tide', JSON.stringify({
      active: 'guest',
      wallets: {
        guest: {
          balance: 200, dayStamp: 0, earnedToday: 0, weekStamp: 0, earnedWeek: 0,
          winsToday: 0, battlesToday: 0, flawlessToday: 0, streak: 0, bestStreakToday: 0,
          claimed: [], rerollSeed: 0, owned: [], equip: {},
        },
      },
    })],
  ]);
}

export function startGuestMode(): boolean {
  const mem = seed();
  const shim: Storage = {
    get length() { return mem.size; },
    clear() { mem.clear(); },
    getItem(k: string) { return mem.has(k) ? mem.get(k)! : null; },
    key(i: number) { return [...mem.keys()][i] ?? null; },
    removeItem(k: string) { mem.delete(k); },
    setItem(k: string, v: string) { mem.set(k, String(v)); },
  };
  try {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: shim });
    active = true;
    return true;
  } catch {
    return false; // couldn't override — falls back to normal storage (degraded)
  }
}
