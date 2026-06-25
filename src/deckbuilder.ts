// Deck builder: choose the 30 chips (and their codes) you take into battle.
// Codes still drive the Custom-window combo discount, so picking codes that line
// up your strike / breach / defense / control packages is part of the strategy.
import {
  CHIP_DEFS, ALL_CHIP_KINDS, CODES, DECK_SIZE,
  getDeck, setDeck, defaultDeck, validateDeck, copiesOf, maxCopiesOf, chipUnlocked,
  type DeckEntry, type ChipKind, type ChipClass,
} from './chips.ts';
import { getCredits, addCredits } from './characters.ts';
import { getWins, getUnlockedChips, unlockChip } from './progress.ts';

const CLS_COLOR: Record<ChipClass, string> = {
  strike: '#ff8f6b', guard: '#6bd0ff', breach: '#d98bff',
  control: '#7af0c0', tempo: '#ffd86b', support: '#9effb0',
};
const CLS_ORDER: ChipClass[] = ['strike', 'breach', 'guard', 'control', 'tempo', 'support'];

export function openDeckBuilder(container: HTMLElement, onClose?: () => void) {
  let deck: DeckEntry[] = getDeck().map((e) => ({ ...e })); // working copy
  let pen = 'A'; // the code newly-added chips receive
  let filter: ChipClass | 'all' = 'all'; // library class filter

  const el = document.createElement('div');
  el.id = 'deckbuilder';
  el.style.cssText = 'position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;background:rgba(4,8,18,.8);font:13px/1.4 ui-monospace,monospace;color:#dfe9ff';
  container.appendChild(el);

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false); };
  document.addEventListener('keydown', onKey);
  function close(save: boolean) {
    if (save) setDeck(deck);
    el.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  }

  const render = () => {
    const v = validateDeck(deck);
    const unlocked = getUnlockedChips();
    const wins = getWins();
    const credits = getCredits();
    // group deck by kind+code for a tidy list
    const groups = new Map<string, { kind: ChipKind; code: string; n: number }>();
    for (const e of deck) {
      const key = e.kind + '|' + e.code;
      const g = groups.get(key) || { kind: e.kind, code: e.code, n: 0 };
      g.n++; groups.set(key, g);
    }
    const deckRows = [...groups.values()]
      .sort((a, b) => CLS_ORDER.indexOf(CHIP_DEFS[a.kind].cls) - CLS_ORDER.indexOf(CHIP_DEFS[b.kind].cls))
      .map((g) => {
        const d = CHIP_DEFS[g.kind];
        return `<div class="db-row" data-rm="${g.kind}|${g.code}" title="click to remove one">
          <span class="db-ic">${d.icon}</span>
          <span class="db-nm" style="color:${CLS_COLOR[d.cls]}">${d.name}</span>
          <span class="db-cd">${g.code === '*' ? '✷' : g.code}</span>
          <span class="db-ct">×${g.n}</span>
          <span class="db-x">✕</span>
        </div>`;
      }).join('') || '<div class="db-empty">Empty — add chips from the library →</div>';

    const HEAL_KINDS = new Set<ChipKind>(['recover', 'megaheal', 'bulwark', 'aura', 'roll']);
    const lib = ALL_CHIP_KINDS
      .filter((k) => filter === 'all' || CHIP_DEFS[k].cls === filter)
      // unlockables sort to the end of each class so the core set reads first
      .slice().sort((a, b) =>
        (CLS_ORDER.indexOf(CHIP_DEFS[a].cls) - CLS_ORDER.indexOf(CHIP_DEFS[b].cls)) ||
        ((CHIP_DEFS[a].unlock ? 1 : 0) - (CHIP_DEFS[b].unlock ? 1 : 0)))
      .map((k) => {
        const d = CHIP_DEFS[k];
        const have = copiesOf(deck, k);
        const max = maxCopiesOf(k);
        const isUnlocked = chipUnlocked(k, unlocked);
        const rar = d.rarity === 'giga' ? '<span class="db-rar giga">GIGA</span>'
                  : d.rarity === 'mega' ? '<span class="db-rar mega">MEGA</span>' : '';
        const meta = `<div class="db-cardmeta"><span style="color:${CLS_COLOR[d.cls]}">${d.cls}</span>${d.damage ? ' · ' + (HEAL_KINDS.has(k) ? '+' : '') + d.damage : ''}</div>`;
        if (!isUnlocked) {
          const u = d.unlock!;
          const gated = wins < u.wins;            // win milestone not yet reached
          const afford = credits >= u.cost;
          const cls = `db-card db-locked${gated ? ' db-gated' : (afford ? ' db-buyable' : ' db-poor')}`;
          const attr = (!gated && afford) ? `data-unlock="${k}"` : '';
          const foot = gated
            ? `<div class="db-lockreq">🔒 Win ${u.wins} <span class="db-dim">(${wins}/${u.wins})</span></div>`
            : `<div class="db-lockreq">${afford ? 'UNLOCK' : 'NEED'} ◈${u.cost}</div>`;
          return `<div class="${cls}" ${attr} title="${d.desc}">
            ${rar}
            <div class="db-cardtop"><span>${d.icon}</span><span class="db-cost">${d.cost}⚡</span></div>
            <div class="db-cardname" style="color:${CLS_COLOR[d.cls]}">${d.name}</div>
            ${meta}
            ${foot}
          </div>`;
        }
        const full = have >= max || deck.length >= DECK_SIZE;
        return `<div class="db-card${full ? ' db-full' : ''}" data-add="${k}" title="${d.desc}">
          ${rar}
          <div class="db-cardtop"><span>${d.icon}</span><span class="db-cost">${d.cost}⚡</span></div>
          <div class="db-cardname" style="color:${CLS_COLOR[d.cls]}">${d.name}</div>
          ${meta}
          <div class="db-have">${have}/${max}</div>
        </div>`;
      }).join('');

    const pens = CODES.map((c) => `<span class="db-pen${c === pen ? ' on' : ''}" data-pen="${c}">${c === '*' ? '✷' : c}</span>`).join('');
    const filters = (['all', ...CLS_ORDER] as const).map((f) => {
      const n = f === 'all' ? ALL_CHIP_KINDS.length : ALL_CHIP_KINDS.filter((k) => CHIP_DEFS[k].cls === f).length;
      const col = f === 'all' ? '#bfe8ff' : CLS_COLOR[f];
      return `<span class="db-filt${f === filter ? ' on' : ''}" data-filt="${f}" style="--fc:${col}">${f} <b>${n}</b></span>`;
    }).join('');

    el.innerHTML = `
      <div class="db-panel">
        <div class="db-head">
          <h2>DECK BUILDER</h2>
          <div class="db-wallet">◈ ${credits} &nbsp;·&nbsp; 🏆 ${wins} wins</div>
          <div class="db-count ${v.ok ? 'ok' : 'bad'}">${deck.length}/${DECK_SIZE} &nbsp;·&nbsp; ${v.msg}</div>
        </div>
        <div class="db-body">
          <div class="db-deck">
            <div class="db-sub">YOUR DECK <span class="db-dim">— click a chip to remove one</span></div>
            <div class="db-list">${deckRows}</div>
          </div>
          <div class="db-lib">
            <div class="db-sub">CHIP LIBRARY <span class="db-dim">— click to add · code</span>
              <span class="db-pens">${pens}</span>
            </div>
            <div class="db-filters">${filters}</div>
            <div class="db-grid">${lib || '<div class="db-empty">No chips in this class.</div>'}</div>
          </div>
        </div>
        <div class="db-foot">
          <button class="btn" data-act="reset">Reset to default</button>
          <span style="flex:1"></span>
          <button class="btn" data-act="cancel">Cancel · Esc</button>
          <button class="btn ${v.ok ? '' : 'db-disabled'}" data-act="save">Save &amp; Close</button>
        </div>
      </div>`;

    el.querySelectorAll('[data-add]').forEach((n) => (n as HTMLElement).onclick = () => {
      const k = (n as HTMLElement).dataset.add as ChipKind;
      if (deck.length >= DECK_SIZE || copiesOf(deck, k) >= maxCopiesOf(k)) return;
      deck.push({ kind: k, code: pen });
      render();
    });
    el.querySelectorAll('[data-rm]').forEach((n) => (n as HTMLElement).onclick = () => {
      const [kind, code] = (n as HTMLElement).dataset.rm!.split('|');
      const i = deck.findIndex((e) => e.kind === kind && e.code === code);
      if (i >= 0) { deck.splice(i, 1); render(); }
    });
    el.querySelectorAll('[data-unlock]').forEach((n) => (n as HTMLElement).onclick = () => {
      const k = (n as HTMLElement).dataset.unlock as ChipKind;
      const u = CHIP_DEFS[k].unlock;
      if (!u || getCredits() < u.cost || getWins() < u.wins) return;
      addCredits(-u.cost);
      unlockChip(k);
      render();
    });
    el.querySelectorAll('[data-pen]').forEach((n) => (n as HTMLElement).onclick = () => { pen = (n as HTMLElement).dataset.pen!; render(); });
    el.querySelectorAll('[data-filt]').forEach((n) => (n as HTMLElement).onclick = () => { filter = (n as HTMLElement).dataset.filt as ChipClass | 'all'; render(); });
    (el.querySelector('[data-act="reset"]') as HTMLElement).onclick = () => { deck = defaultDeck(); render(); };
    (el.querySelector('[data-act="cancel"]') as HTMLElement).onclick = () => close(false);
    (el.querySelector('[data-act="save"]') as HTMLElement).onclick = () => { if (validateDeck(deck).ok) close(true); };
  };

  render();
}
