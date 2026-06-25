// Chip Shop — a storefront for the unlockable chips. The deck builder can also
// unlock chips inline, but the shop is the "proper" vendor and runs rotating
// DAILY DEALS (a discount on a few chips each day) so it's the cheaper place to
// buy. Purchases reuse the same unlock economy (credits + win-gate → unlockChip).
import {
  CHIP_DEFS, ALL_CHIP_KINDS, chipUnlocked,
  type ChipKind, type ChipClass,
} from './chips.ts';
import { getCredits, addCredits } from './characters.ts';
import { getWins, getUnlockedChips, unlockChip } from './progress.ts';

const CLS_COLOR: Record<ChipClass, string> = {
  strike: '#ff8f6b', guard: '#6bd0ff', breach: '#d98bff',
  control: '#7af0c0', tempo: '#ffd86b', support: '#9effb0',
};
const HEAL_KINDS = new Set<ChipKind>(['recover', 'megaheal', 'bulwark', 'aura', 'roll']);
const DEAL_OFF = 0.25; // daily-deal discount

// Every chip the shop stocks (i.e. has an unlock gate).
const STOCK = ALL_CHIP_KINDS.filter((k) => CHIP_DEFS[k].unlock);

// A day-seeded pick of up to 3 deal chips, drawn from those still locked.
function dailyDeals(lockedPool: ChipKind[]): Set<ChipKind> {
  const day = Math.floor(Date.now() / 86400000);
  let s = ((day * 9301 + 49297) % 233280 + 233280) % 233280;
  const rng = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const arr = [...lockedPool];
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return new Set(arr.slice(0, 3));
}

export function openChipShop(container: HTMLElement, onClose?: () => void) {
  const el = document.createElement('div');
  el.id = 'chipshop';
  el.style.cssText = 'position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;background:rgba(4,8,18,.82);font:13px/1.4 ui-monospace,monospace;color:#dfe9ff';
  container.appendChild(el);

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  function close() { el.remove(); document.removeEventListener('keydown', onKey); onClose?.(); }

  // freeze today's deals to the chips that were locked when the shop opened
  const deals = dailyDeals(STOCK.filter((k) => !chipUnlocked(k, getUnlockedChips())));

  const priceOf = (k: ChipKind) => {
    const base = CHIP_DEFS[k].unlock!.cost;
    return deals.has(k) ? Math.round(base * (1 - DEAL_OFF)) : base;
  };

  const buy = (k: ChipKind) => {
    const d = CHIP_DEFS[k];
    if (!d.unlock || chipUnlocked(k, getUnlockedChips())) return;
    if (getWins() < d.unlock.wins || getCredits() < priceOf(k)) return;
    addCredits(-priceOf(k));
    unlockChip(k);
    render();
  };

  const card = (k: ChipKind, unlocked: Set<string>, wins: number, credits: number) => {
    const d = CHIP_DEFS[k];
    const u = d.unlock!;
    const owned = chipUnlocked(k, unlocked);
    const onDeal = deals.has(k);
    const price = priceOf(k);
    const gated = !owned && wins < u.wins;
    const afford = credits >= price;
    const rar = d.rarity === 'giga' ? '<span class="db-rar giga">GIGA</span>'
              : d.rarity === 'mega' ? '<span class="db-rar mega">MEGA</span>' : '';
    const deal = onDeal && !owned ? `<span class="shop-deal">-${Math.round(DEAL_OFF * 100)}%</span>` : '';
    const state = owned ? 'owned' : gated ? 'gated' : afford ? 'buyable' : 'poor';
    const attr = state === 'buyable' ? `data-buy="${k}"` : '';
    const foot = owned ? '<div class="shop-btn owned">✓ OWNED</div>'
      : gated ? `<div class="shop-btn gated">🔒 Win ${u.wins} <span class="db-dim">(${wins}/${u.wins})</span></div>`
      : afford ? `<div class="shop-btn buy">BUY ◈${price}${onDeal ? ` <s>${u.cost}</s>` : ''}</div>`
      : `<div class="shop-btn poor">◈${price} — need more</div>`;
    return `<div class="shop-card ${state}" ${attr} title="${d.desc}">
      ${rar}${deal}
      <div class="shop-cardtop"><span class="shop-ic">${d.icon}</span><span class="db-cost">${d.cost}⚡</span></div>
      <div class="shop-name" style="color:${CLS_COLOR[d.cls]}">${d.name}</div>
      <div class="shop-meta"><span style="color:${CLS_COLOR[d.cls]}">${d.cls}</span>${d.damage ? ' · ' + (HEAL_KINDS.has(k) ? '+' : '') + d.damage : ''}</div>
      <div class="shop-desc">${d.desc.replace(/\s*\([^)]*\)\s*$/, '')}</div>
      ${foot}
    </div>`;
  };

  const render = () => {
    const unlocked = getUnlockedChips();
    const wins = getWins();
    const credits = getCredits();

    const dealCards = STOCK.filter((k) => deals.has(k) && !chipUnlocked(k, unlocked))
      .map((k) => card(k, unlocked, wins, credits)).join('');
    const allOwned = STOCK.every((k) => chipUnlocked(k, unlocked));
    const grid = STOCK
      .slice().sort((a, b) => (chipUnlocked(a, unlocked) ? 1 : 0) - (chipUnlocked(b, unlocked) ? 1 : 0))
      .map((k) => card(k, unlocked, wins, credits)).join('');

    el.innerHTML = `
      <div class="shop-panel">
        <div class="shop-head">
          <h2>⊞ CHIP SHOP</h2>
          <div class="shop-flavor">"Fresh ops, agent. Daily deals while compute lasts."</div>
          <div class="db-wallet">◈ ${credits} &nbsp;·&nbsp; 🏆 ${wins} wins</div>
        </div>
        ${dealCards ? `<div class="shop-sub">✦ TODAY'S DEALS <span class="db-dim">— ${Math.round(DEAL_OFF * 100)}% off, refreshes daily</span></div>
          <div class="shop-grid shop-deals">${dealCards}</div>` : ''}
        <div class="shop-sub">STOCK <span class="db-dim">— buy once; then build with it in any deck</span></div>
        <div class="shop-grid">${allOwned ? '<div class="db-empty">You own every chip in stock. Nice folder. ✓</div>' : grid}</div>
        <div class="shop-foot">
          <span class="db-dim">Buying unlocks a chip for deck-building. Win battles to earn ◈ &amp; meet level gates.</span>
          <span style="flex:1"></span>
          <button class="btn" data-act="close">Close · Esc</button>
        </div>
      </div>`;

    el.querySelectorAll('[data-buy]').forEach((n) => (n as HTMLElement).onclick = () => buy((n as HTMLElement).dataset.buy as ChipKind));
    (el.querySelector('[data-act="close"]') as HTMLElement).onclick = () => close();
  };

  render();
}
