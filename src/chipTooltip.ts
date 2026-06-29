// Global rich hover tooltip for chips. Any element tagged with data-chip-kind
// (a ChipKind) or data-chip-pa (a Program-Advance id) shows a card with the
// custom art + full stats on hover. One document-level listener drives it, so
// every screen that lists chips (deck builder, shop, battle hand) gets it for
// free just by tagging the markup.
import { CHIP_DEFS, maxCopiesOf, PROGRAM_ADVANCES, type ChipKind } from './chips.ts';
import { chipArtURL, paArtURL } from './chipart.ts';

const CLS_COLOR: Record<string, string> = {
  strike: '#ff6b7e', guard: '#5ab0ff', breach: '#c46bff',
  control: '#42e8c0', tempo: '#ffd24a', support: '#5affa0',
};
const CLS_LABEL: Record<string, string> = {
  strike: 'STRIKE', guard: 'GUARD', breach: 'BREACH',
  control: 'CONTROL', tempo: 'TEMPO', support: 'SUPPORT',
};
const HEAL = new Set<ChipKind>(['recover', 'megaheal', 'roll', 'leech', 'drain']);

let tip: HTMLElement | null = null;
let curKey = '';

function ensure(): HTMLElement {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chiptip';
    tip.style.display = 'none';
    document.body.appendChild(tip);
  }
  return tip;
}

function rarityBadge(kind: ChipKind): string {
  const max = maxCopiesOf(kind);
  if (max <= 1) return `<span class="ct-rar giga">GIGA</span>`;
  if (max <= 2) return `<span class="ct-rar mega">MEGA</span>`;
  return `<span class="ct-rar std">STD ·×${max}</span>`;
}

function chipHTML(kind: ChipKind): string {
  const d = CHIP_DEFS[kind];
  const color = CLS_COLOR[d.cls];
  const dmg = d.damage ? `<span class="ct-stat">${HEAL.has(kind) ? '♥ +' : '⚔ '}${d.damage}</span>` : '';
  const unlock = d.unlock
    ? `<div class="ct-unlock">🔒 Unlock: ◈ ${d.unlock.cost} · ${d.unlock.wins} wins</div>` : '';
  return `
    <img class="ct-art" src="${chipArtURL(kind)}" alt="">
    <div class="ct-body">
      <div class="ct-name" style="color:${color}">${d.name}</div>
      <div class="ct-badges">
        <span class="ct-cls" style="color:${color};border-color:${color}">${CLS_LABEL[d.cls]}</span>
        ${rarityBadge(kind)}
        <span class="ct-stat">⚡ ${d.cost}</span>${dmg}
      </div>
      <div class="ct-desc">${d.desc}</div>
      ${unlock}
    </div>`;
}

function paHTML(id: string): string {
  const pa = PROGRAM_ADVANCES.find((p) => p.id === id);
  if (!pa) return '';
  const recipe = pa.recipe.map((k) => CHIP_DEFS[k].name).join(' → ');
  return `
    <img class="ct-art" src="${paArtURL(pa.id, pa.icon)}" alt="">
    <div class="ct-body">
      <div class="ct-name" style="color:#ffd86b">${pa.name}</div>
      <div class="ct-badges"><span class="ct-rar pa">PROGRAM ADVANCE</span></div>
      <div class="ct-recipe">${recipe}</div>
      <div class="ct-desc">${pa.desc}</div>
    </div>`;
}

function position(x: number, y: number) {
  const el = ensure();
  const w = el.offsetWidth || 280, h = el.offsetHeight || 160;
  let lx = x + 18, ly = y + 18;
  if (lx + w > window.innerWidth - 8) lx = x - w - 18;
  if (ly + h > window.innerHeight - 8) ly = window.innerHeight - h - 8;
  if (ly < 8) ly = 8;
  el.style.left = lx + 'px';
  el.style.top = ly + 'px';
}

function hide() {
  if (tip) tip.style.display = 'none';
  curKey = '';
}

// one listener: on every move, show/update for whatever chip element is under
// the cursor (cheap — content only rebuilds when the target chip changes).
function onMove(e: MouseEvent) {
  const t = (e.target as HTMLElement | null)?.closest('[data-chip-kind],[data-chip-pa]') as HTMLElement | null;
  if (!t) { if (curKey) hide(); return; }
  const kind = t.dataset.chipKind as ChipKind | undefined;
  const pa = t.dataset.chipPa;
  const key = kind ? 'k:' + kind : 'p:' + pa;
  const el = ensure();
  if (key !== curKey) {
    el.innerHTML = kind ? chipHTML(kind) : paHTML(pa!);
    el.style.display = 'flex';
    curKey = key;
  }
  position(e.clientX, e.clientY);
}

let inited = false;
export function initChipTooltips() {
  if (inited) return;
  inited = true;
  document.addEventListener('mousemove', onMove, { passive: true });
  // hide if a scroll / click changes the layout under the cursor
  document.addEventListener('mousedown', hide, true);
  window.addEventListener('blur', hide);
}
