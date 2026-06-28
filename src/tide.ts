// ◊ TIDE — the play-and-own economy (Phase 1: SIMULATED / off-chain).
//
// Everything here is a local, wallet-scoped ledger so it maps 1:1 onto a real
// Solana SPL token later with no UX change. Design (see the P2E spec):
//  - Hard DAILY/WEEKLY caps; a base character can barely approach the daily cap.
//  - Earn rate scales with CLEARANCE LEVEL (from cumulative wins — skill/time,
//    never purchasable, so it's not pay-to-win).
//  - Win bonuses have steep diminishing returns; quests are CL-gated.
//  - Many ◊ SINKS (cosmetics) keep supply flat/down.
import { getWins } from './progress.ts';

const KEY = 'abyssal.tide';
const DAY_MS = 86400000;
export const DAILY_CAP = 50;
export const WEEKLY_CAP = 300;
const WIN_BASE = 5;        // base ◊ for the day's first PvE win (before CL mult + decay)
const REROLL_COST = 5;     // ◊ to reroll today's quest board

const dayIndex = () => Math.floor(Date.now() / DAY_MS);
const weekIndex = () => Math.floor(dayIndex() / 7);

interface Wallet {
  balance: number;
  dayStamp: number; earnedToday: number;
  weekStamp: number; earnedWeek: number;
  winsToday: number; battlesToday: number; flawlessToday: number;
  streak: number; bestStreakToday: number;
  claimed: string[];      // quest ids claimed today
  rerollSeed: number;     // bumped each paid reroll → new deterministic board
  owned: string[];        // cosmetics in the vault
  equip: { title?: string; badge?: string; color?: string };
  nftAssets?: Record<string, string>; // legendary cosmetic id → on-chain asset address
}
interface Store { active: string; wallets: Record<string, Wallet> }

function freshWallet(): Wallet {
  return {
    balance: 0, dayStamp: dayIndex(), earnedToday: 0, weekStamp: weekIndex(), earnedWeek: 0,
    winsToday: 0, battlesToday: 0, flawlessToday: 0, streak: 0, bestStreakToday: 0,
    claimed: [], rerollSeed: 0, owned: [], equip: {},
  };
}
function read(): Store {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.wallets) return s; } catch { /* ignore */ }
  return { active: 'guest', wallets: {} };
}
function write(s: Store) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }

// roll the daily/weekly counters over if the date changed
function rollover(w: Wallet): Wallet {
  if (w.dayStamp !== dayIndex()) {
    w.dayStamp = dayIndex();
    w.earnedToday = 0; w.winsToday = 0; w.battlesToday = 0; w.flawlessToday = 0;
    w.streak = 0; w.bestStreakToday = 0; w.claimed = []; w.rerollSeed = 0;
  }
  if (w.weekStamp !== weekIndex()) { w.weekStamp = weekIndex(); w.earnedWeek = 0; }
  return w;
}

let store = read();
function cur(): Wallet {
  const w = store.wallets[store.active] || (store.wallets[store.active] = freshWallet());
  rollover(w);
  return w;
}
function save() { write(store); }

// call at login / overworld init with the connected wallet address
export function initTide(address: string) {
  store = read();
  store.active = address || 'guest';
  if (!store.wallets[store.active]) store.wallets[store.active] = freshWallet();
  rollover(store.wallets[store.active]);
  save();
}

// ---------------- Clearance Level (earn-rate gate, skill-based) ----------------
export interface Clearance { level: number; mult: number; slots: number; hard: number; nextAt: number | null }
export function getClearance(): Clearance {
  const wins = getWins();
  const level = Math.max(1, Math.min(10, Math.floor(Math.sqrt(wins))));
  const mult = Math.round((1 + (level - 1) * 0.055) * 100) / 100; // ×1.0 → ×1.5
  const slots = level >= 5 ? 3 : level >= 3 ? 2 : 1;
  const hard = level >= 8 ? 2 : level >= 5 ? 1 : 0;
  const nextAt = level < 10 ? (level + 1) * (level + 1) : null; // wins needed for next CL
  return { level, mult, slots, hard, nextAt };
}

export function getTide(): number { return cur().balance; }
export interface DayInfo { earned: number; cap: number; remaining: number; weekEarned: number; weekCap: number }
export function dayInfo(): DayInfo {
  const w = cur();
  return { earned: w.earnedToday, cap: DAILY_CAP, remaining: Math.max(0, DAILY_CAP - w.earnedToday), weekEarned: w.earnedWeek, weekCap: WEEKLY_CAP };
}

// add ◊, clamped by the daily + weekly caps. Returns ◊ actually credited.
export function earnTide(amount: number): number {
  if (amount <= 0) return 0;
  const w = cur();
  const room = Math.max(0, Math.min(DAILY_CAP - w.earnedToday, WEEKLY_CAP - w.earnedWeek));
  const got = Math.min(amount, room);
  if (got > 0) { w.balance += got; w.earnedToday += got; w.earnedWeek += got; save(); }
  return got;
}

// spend ◊ (sinks). Returns true if affordable.
export function spendTide(amount: number): boolean {
  const w = cur();
  if (w.balance < amount) return false;
  w.balance -= amount; save();
  return true;
}

// ---------------- Battle hook ----------------
// Record a finished PvE battle. On a win, award the diminishing win bonus.
export function recordBattle(win: boolean, flawless: boolean): number {
  const w = cur();
  w.battlesToday++;
  if (!win) { w.streak = 0; save(); return 0; }
  w.winsToday++;
  w.streak++; w.bestStreakToday = Math.max(w.bestStreakToday, w.streak);
  if (flawless) w.flawlessToday++;
  const { mult } = getClearance();
  const decay = Math.max(0.2, 1 - 0.18 * (w.winsToday - 1));
  const bonus = Math.round(WIN_BASE * mult * decay);
  save();
  return earnTide(bonus);
}

// ---------------- Daily quests ----------------
export type QuestType = 'win' | 'play' | 'streak' | 'flawless';
export interface QuestDef { id: string; type: QuestType; target: number; reward: number; hard: boolean; desc: string }
const QUEST_POOL: QuestDef[] = [
  { id: 'win2',   type: 'win',      target: 2, reward: 8,  hard: false, desc: 'Win 2 duels' },
  { id: 'win3',   type: 'win',      target: 3, reward: 11, hard: false, desc: 'Win 3 duels' },
  { id: 'play3',  type: 'play',     target: 3, reward: 6,  hard: false, desc: 'Fight 3 battles' },
  { id: 'play5',  type: 'play',     target: 5, reward: 9,  hard: false, desc: 'Fight 5 battles' },
  { id: 'streak2',type: 'streak',   target: 2, reward: 10, hard: false, desc: 'Win 2 in a row' },
  // hard (CL-gated)
  { id: 'win5',   type: 'win',      target: 5, reward: 15, hard: true,  desc: 'Win 5 duels' },
  { id: 'streak3',type: 'streak',   target: 3, reward: 15, hard: true,  desc: 'Win 3 in a row' },
  { id: 'flaw2',  type: 'flawless', target: 2, reward: 16, hard: true,  desc: 'Win 2 dominantly (>50% integrity)' },
];

function seededPick(pool: QuestDef[], n: number, seed: number): QuestDef[] {
  const a = [...pool];
  let s = ((seed * 9301 + 49297) % 233280 + 233280) % 233280;
  const rng = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

export interface QuestView extends QuestDef { progress: number; done: boolean; claimed: boolean }
function counterFor(w: Wallet, t: QuestType): number {
  return t === 'win' ? w.winsToday : t === 'play' ? w.battlesToday : t === 'streak' ? w.bestStreakToday : w.flawlessToday;
}
export function getDailyQuests(): QuestView[] {
  const w = cur();
  const { slots, hard } = getClearance();
  const seed = dayIndex() * 31 + w.rerollSeed * 1009;
  const easy = seededPick(QUEST_POOL.filter((q) => !q.hard), slots, seed);
  const hards = seededPick(QUEST_POOL.filter((q) => q.hard), hard, seed + 7);
  return [...easy, ...hards].map((q) => {
    const progress = Math.min(q.target, counterFor(w, q.type));
    return { ...q, progress, done: progress >= q.target, claimed: w.claimed.includes(q.id) };
  });
}

export function claimQuest(id: string): number {
  const w = cur();
  const q = getDailyQuests().find((x) => x.id === id);
  if (!q || !q.done || q.claimed) return 0;
  w.claimed.push(id); save();
  return earnTide(q.reward);
}

export function rerollQuests(): boolean {
  const w = cur();
  if (w.balance < REROLL_COST) return false;
  w.balance -= REROLL_COST; w.rerollSeed++; save();
  return true;
}
export const rerollCost = REROLL_COST;

// ---------------- Cosmetics vault (◊ sinks) ----------------
export type CosmeticKind = 'title' | 'badge' | 'color';
// `nft: true` = a LEGENDARY-tier cosmetic. Only these become real on-chain
// Metaplex NFTs in a later phase; everything else stays a lightweight off-chain
// cosmetic. Kept scarce + top-priced so the NFT tier is genuine prestige.
export interface Cosmetic { id: string; kind: CosmeticKind; name: string; price: number; value: string; nft?: boolean }
export const COSMETICS: Cosmetic[] = [
  // badges (shown before your name to other players)
  { id: 'b_wave',  kind: 'badge', name: 'Datastream Badge', price: 60,  value: '💠' },
  { id: 'b_skull', kind: 'badge', name: 'Reaper Badge',     price: 90,  value: '☠️' },
  { id: 'b_snow',  kind: 'badge', name: 'Cryo Badge',       price: 90,  value: '❄️' },
  { id: 'b_bolt',  kind: 'badge', name: 'Overclock Badge',  price: 120, value: '⚡' },
  { id: 'b_crown', kind: 'badge', name: 'Apex Badge',       price: 400, value: '👑', nft: true },
  // titles
  { id: 't_rookie',kind: 'title', name: 'Title: Rookie',     price: 40,  value: 'Rookie' },
  { id: 't_tempest',kind:'title', name: 'Title: Tempest Caller', price: 150, value: 'Tempest Caller' },
  { id: 't_zero',  kind: 'title', name: 'Title: Absolute Zero',  price: 150, value: 'Absolute Zero' },
  { id: 't_apex',  kind: 'title', name: 'Title: Apex Process',   price: 500, value: 'Apex Process', nft: true },
  // name colors
  { id: 'c_cyan',  kind: 'color', name: 'Name Color: Cyan',  price: 50,  value: '#39d0ff' },
  { id: 'c_magenta',kind:'color', name: 'Name Color: Magenta',price: 50, value: '#d96bff' },
  { id: 'c_gold',  kind: 'color', name: 'Name Color: Gold',  price: 120, value: '#ffd86b' },
  { id: 'c_mint',  kind: 'color', name: 'Name Color: Mint',  price: 120, value: '#9effc4' },
  { id: 'c_prism', kind: 'color', name: 'Name Color: Prismatic', price: 450, value: '#7af0ff', nft: true },
];
export function isNftCosmetic(id: string): boolean { return !!COSMETICS.find((c) => c.id === id)?.nft; }

export function getOwnedCosmetics(): string[] { return [...cur().owned]; }
export function ownsCosmetic(id: string): boolean { return cur().owned.includes(id); }
export function mintCosmetic(id: string): boolean {
  const c = COSMETICS.find((x) => x.id === id);
  const w = cur();
  // legendary (nft) cosmetics are minted on-chain, not bought with ◊
  if (!c || c.nft || w.owned.includes(id) || w.balance < c.price) return false;
  w.balance -= c.price; w.owned.push(id);
  // auto-equip the first of each kind you buy
  if (!w.equip[c.kind]) w.equip[c.kind] = id;
  save();
  return true;
}

// record a successful on-chain mint of a legendary cosmetic
export function getNftAsset(id: string): string | undefined { return cur().nftAssets?.[id]; }
export function recordNftMint(id: string, asset: string): void {
  const c = COSMETICS.find((x) => x.id === id);
  const w = cur();
  if (!c) return;
  (w.nftAssets ??= {})[id] = asset;
  if (!w.owned.includes(id)) w.owned.push(id);
  if (!w.equip[c.kind]) w.equip[c.kind] = id; // auto-equip your new legendary
  save();
}
export function getEquip(): { title?: string; badge?: string; color?: string } { return { ...cur().equip }; }
export function equipCosmetic(id: string): void {
  const c = COSMETICS.find((x) => x.id === id);
  const w = cur();
  if (!c || !w.owned.includes(id)) return;
  w.equip[c.kind] = w.equip[c.kind] === id ? undefined : id; // toggle off if re-clicked
  save();
}
function equippedValue(kind: CosmeticKind): string | undefined {
  const id = cur().equip[kind];
  return id ? COSMETICS.find((c) => c.id === id)?.value : undefined;
}
export const equippedTitle = () => equippedValue('title');
export const equippedBadge = () => equippedValue('badge');
export const equippedColor = () => equippedValue('color');

// decorate a display name with the equipped badge (for multiplayer flex)
export function decorateName(name: string): string {
  const b = equippedBadge();
  return b ? `${b} ${name}` : name;
}
