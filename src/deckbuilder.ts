// Deck builder: pick the 30 chips (and codes) you take into battle, manage
// multiple named deck slots, study deck analytics + Program Advance recipes, and
// install NaviCust passive programs. Codes drive the Custom-window combo discount,
// so code-planning your strike/breach/defense/control packages is part of it.
import {
  CHIP_DEFS, ALL_CHIP_KINDS, CODES, DECK_SIZE, PROGRAM_ADVANCES,
  getDeck, setDeck, defaultDeck, validateDeck, copiesOf, maxCopiesOf, chipUnlocked,
  getDeckSlots, getActiveSlot, setActiveSlot, addDeckSlot, deleteDeckSlot, renameDeck, MAX_DECK_SLOTS,
  type DeckEntry, type ChipKind, type ChipClass,
} from './chips.ts';
import { getCredits, addCredits } from './characters.ts';
import { getWins, getUnlockedChips, unlockChip } from './progress.ts';
import { PROGRAMS, memBudget, memUsed, getEquipped, toggleProgram } from './navicust.ts';
import { chipArtURL, paArtURL } from './chipart.ts';

const CLS_COLOR: Record<ChipClass, string> = {
  strike: '#ff8f6b', guard: '#6bd0ff', breach: '#d98bff',
  control: '#7af0c0', tempo: '#ffd86b', support: '#9effb0',
};
const CLS_ORDER: ChipClass[] = ['strike', 'breach', 'guard', 'control', 'tempo', 'support'];
const HEAL_KINDS = new Set<ChipKind>(['recover', 'megaheal', 'bulwark', 'aura', 'roll']);

export function openDeckBuilder(container: HTMLElement, onClose?: () => void) {
  let deck: DeckEntry[] = getDeck().map((e) => ({ ...e })); // working copy of the active slot
  let pen = 'A';                         // the code newly-added chips receive
  let filter: ChipClass | 'all' = 'all'; // library class filter
  let mode: 'chips' | 'programs' = 'chips';

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

  // switch the active deck slot — persist the current working copy first
  const switchSlot = (i: number) => { setDeck(deck); setActiveSlot(i); deck = getDeck().map((e) => ({ ...e })); render(); };

  // ---- deck analytics ----
  function analytics() {
    const cost: Record<number, number> = {};
    const cls: Record<string, number> = {};
    const codeN: Record<string, number> = {};
    let dmgSum = 0, dmgN = 0, costSum = 0;
    for (const e of deck) {
      const d = CHIP_DEFS[e.kind];
      cost[d.cost] = (cost[d.cost] || 0) + 1; costSum += d.cost;
      cls[d.cls] = (cls[d.cls] || 0) + 1;
      codeN[e.code] = (codeN[e.code] || 0) + 1;
      if (d.damage && !HEAL_KINDS.has(e.kind)) { dmgSum += d.damage; dmgN++; }
    }
    const topCode = Object.entries(codeN).sort((a, b) => b[1] - a[1])[0];
    return {
      cost, cls,
      avgCost: deck.length ? costSum / deck.length : 0,
      avgDmg: dmgN ? dmgSum / dmgN : 0,
      distinctCodes: Object.keys(codeN).length,
      topCode: topCode ? { code: topCode[0], n: topCode[1] } : null,
    };
  }

  function analyticsHTML() {
    const a = analytics();
    const maxCost = 5;
    const costBars = Array.from({ length: maxCost }, (_, i) => {
      const c = i + 1; const n = a.cost[c] || 0;
      const h = Math.min(100, n * 14);
      return `<div class="db-bar" title="${n} chip(s) cost ${c}"><div class="db-barfill" style="height:${h}%"></div><span>${c}</span></div>`;
    }).join('');
    const clsPie = CLS_ORDER.map((c) => {
      const n = a.cls[c] || 0; if (!n) return '';
      return `<span class="db-clschip" style="--c:${CLS_COLOR[c]}">${c.slice(0, 3)} ${n}</span>`;
    }).join('');
    return `
      <div class="db-stats">
        <div class="db-statrow"><span class="db-dim">RAM curve</span><div class="db-bars">${costBars}</div></div>
        <div class="db-statrow db-clsrow">${clsPie || '<span class="db-dim">—</span>'}</div>
        <div class="db-statrow db-statnums">
          <span>avg RAM <b>${a.avgCost.toFixed(1)}</b></span>
          <span>avg dmg <b>${a.avgDmg ? Math.round(a.avgDmg) : '—'}</b></span>
          <span>codes <b>${a.distinctCodes}</b></span>
          <span title="biggest combo-discount group">top combo <b>${a.topCode ? (a.topCode.code === '*' ? '✷' : a.topCode.code) + '×' + a.topCode.n : '—'}</b></span>
        </div>
      </div>`;
  }

  // ---- Program Advance reference ----
  function paRefHTML() {
    const rows = PROGRAM_ADVANCES.map((pa) => {
      const recipe = pa.recipe.map((k) => CHIP_DEFS[k].icon).join(' + ');
      const names = pa.recipe.map((k) => CHIP_DEFS[k].name).join(' → ');
      void names;
      return `<div class="db-parow" data-chip-pa="${pa.id}">
        <img class="db-paic-art" src="${paArtURL(pa.id, pa.icon)}" alt="">
        <span class="db-paname">${pa.name}</span>
        <span class="db-parecipe">${recipe}</span>
      </div>`;
    }).join('');
    return `<div class="db-pasub">⚡ PROGRAM ADVANCES <span class="db-dim">— queue the exact combo in one Custom window</span></div>
      <div class="db-palist">${rows}</div>`;
  }

  // ---- chip library card ----
  function cardHTML(k: ChipKind, unlocked: Set<string>, wins: number, credits: number) {
    const d = CHIP_DEFS[k];
    const have = copiesOf(deck, k);
    const max = maxCopiesOf(k);
    const rar = d.rarity === 'giga' ? '<span class="db-rar giga">GIGA</span>'
              : d.rarity === 'mega' ? '<span class="db-rar mega">MEGA</span>' : '';
    const meta = `<div class="db-cardmeta"><span style="color:${CLS_COLOR[d.cls]}">${d.cls}</span>${d.damage ? ' · ' + (HEAL_KINDS.has(k) ? '+' : '') + d.damage : ''}</div>`;
    if (!chipUnlocked(k, unlocked)) {
      const u = d.unlock!;
      const gated = wins < u.wins;
      const afford = credits >= u.cost;
      const cls = `db-card db-locked${gated ? ' db-gated' : (afford ? ' db-buyable' : ' db-poor')}`;
      const attr = (!gated && afford) ? `data-unlock="${k}"` : '';
      const foot = gated
        ? `<div class="db-lockreq">🔒 Win ${u.wins} <span class="db-dim">(${wins}/${u.wins})</span></div>`
        : `<div class="db-lockreq">${afford ? 'UNLOCK' : 'NEED'} ◈${u.cost}</div>`;
      return `<div class="${cls}" ${attr} data-chip-kind="${k}">${rar}
        <div class="db-cardtop"><img class="db-cardart" src="${chipArtURL(k)}" alt=""><span class="db-cost">${d.cost}⚡</span></div>
        <div class="db-cardname" style="color:${CLS_COLOR[d.cls]}">${d.name}</div>${meta}${foot}</div>`;
    }
    const full = have >= max || deck.length >= DECK_SIZE;
    return `<div class="db-card${full ? ' db-full' : ''}" data-add="${k}" data-chip-kind="${k}">${rar}
      <div class="db-cardtop"><img class="db-cardart" src="${chipArtURL(k)}" alt=""><span class="db-cost">${d.cost}⚡</span></div>
      <div class="db-cardname" style="color:${CLS_COLOR[d.cls]}">${d.name}</div>${meta}
      <div class="db-have">${have}/${max}</div></div>`;
  }

  // ---- NaviCust program card ----
  function programHTML() {
    const eq = new Set(getEquipped());
    const used = memUsed();
    const budget = memBudget();
    const cards = PROGRAMS.map((p) => {
      const on = eq.has(p.id);
      const tooBig = !on && used + p.mem > budget;
      return `<div class="db-card db-prog${on ? ' on' : ''}${tooBig ? ' db-full' : ''}" data-prog="${p.id}" title="${p.desc}">
        <div class="db-cardtop"><span>${p.icon}</span><span class="db-cost">${p.mem}◇</span></div>
        <div class="db-cardname">${p.name}</div>
        <div class="db-cardmeta">${p.desc}</div>
        ${on ? '<div class="db-have" style="color:#9eff8f">✓ ON</div>' : ''}
      </div>`;
    }).join('');
    const pct = Math.min(100, (used / budget) * 100);
    return `
      <div class="db-navi">
        <div class="db-sub">NAVICUST PROGRAMS <span class="db-dim">— passive boosts; budget grows as you win</span></div>
        <div class="db-membar"><div class="db-memfill" style="width:${pct}%"></div>
          <span class="db-memlabel">MEMORY ${used} / ${budget} ◇</span></div>
        <div class="db-grid db-proggrid">${cards}</div>
      </div>`;
  }

  const render = () => {
    const v = validateDeck(deck);
    const unlocked = getUnlockedChips();
    const wins = getWins();
    const credits = getCredits();

    // deck list grouped by kind+code
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
        return `<div class="db-row" data-rm="${g.kind}|${g.code}" data-chip-kind="${g.kind}">
          <img class="db-ic-art" src="${chipArtURL(g.kind)}" alt="">
          <span class="db-nm" style="color:${CLS_COLOR[d.cls]}">${d.name}</span>
          <span class="db-cd">${g.code === '*' ? '✷' : g.code}</span>
          <span class="db-ct">×${g.n}</span>
          <span class="db-x">✕</span>
        </div>`;
      }).join('') || '<div class="db-empty">Empty — add chips from the library →</div>';

    const lib = ALL_CHIP_KINDS
      .filter((k) => filter === 'all' || CHIP_DEFS[k].cls === filter)
      .slice().sort((a, b) =>
        (CLS_ORDER.indexOf(CHIP_DEFS[a].cls) - CLS_ORDER.indexOf(CHIP_DEFS[b].cls)) ||
        ((CHIP_DEFS[a].unlock ? 1 : 0) - (CHIP_DEFS[b].unlock ? 1 : 0)))
      .map((k) => cardHTML(k, unlocked, wins, credits)).join('');

    const pens = CODES.map((c) => `<span class="db-pen${c === pen ? ' on' : ''}" data-pen="${c}">${c === '*' ? '✷' : c}</span>`).join('');
    const filters = (['all', ...CLS_ORDER] as const).map((f) => {
      const n = f === 'all' ? ALL_CHIP_KINDS.length : ALL_CHIP_KINDS.filter((k) => CHIP_DEFS[k].cls === f).length;
      const col = f === 'all' ? '#bfe8ff' : CLS_COLOR[f];
      return `<span class="db-filt${f === filter ? ' on' : ''}" data-filt="${f}" style="--fc:${col}">${f} <b>${n}</b></span>`;
    }).join('');

    // deck-slot tabs
    const slots = getDeckSlots();
    const active = getActiveSlot();
    const slotTabs = slots.map((s, i) =>
      `<span class="db-slot${i === active ? ' on' : ''}" data-slot="${i}">${s.name}${i === active ? ' <b class="db-slotedit" data-ren="1">✎</b>' : ''}${i === active && slots.length > 1 ? ' <b class="db-slotdel" data-del="1">✕</b>' : ''}</span>`,
    ).join('') + (slots.length < MAX_DECK_SLOTS ? '<span class="db-slot db-slotadd" data-addslot="1">+ deck</span>' : '');

    const chipsBody = `
      <div class="db-body">
        <div class="db-deck">
          <div class="db-sub">YOUR DECK <span class="db-dim">— click a chip to remove one</span></div>
          <div class="db-list">${deckRows}</div>
          ${analyticsHTML()}
          ${paRefHTML()}
        </div>
        <div class="db-lib">
          <div class="db-sub">CHIP LIBRARY <span class="db-dim">— click to add · code</span>
            <span class="db-pens">${pens}</span>
          </div>
          <div class="db-filters">${filters}</div>
          <div class="db-grid">${lib || '<div class="db-empty">No chips in this class.</div>'}</div>
        </div>
      </div>`;

    el.innerHTML = `
      <div class="db-panel">
        <div class="db-head">
          <div class="db-tabs">
            <span class="db-tab${mode === 'chips' ? ' on' : ''}" data-mode="chips">⊟ CHIPS</span>
            <span class="db-tab${mode === 'programs' ? ' on' : ''}" data-mode="programs">⚙ PROGRAMS</span>
          </div>
          <div class="db-wallet">◈ ${credits} &nbsp;·&nbsp; 🏆 ${wins} wins</div>
          <div class="db-count ${v.ok ? 'ok' : 'bad'}">${deck.length}/${DECK_SIZE} &nbsp;·&nbsp; ${v.msg}</div>
        </div>
        ${mode === 'chips' ? `<div class="db-slots">${slotTabs}</div>` : ''}
        ${mode === 'chips' ? chipsBody : `<div class="db-body db-bodyprog">${programHTML()}</div>`}
        <div class="db-foot">
          ${mode === 'chips' ? '<button class="btn" data-act="reset">Reset to default</button>' : '<span class="db-dim">NaviCust changes save instantly.</span>'}
          <span style="flex:1"></span>
          <button class="btn" data-act="cancel">Cancel · Esc</button>
          <button class="btn ${v.ok ? '' : 'db-disabled'}" data-act="save">Save &amp; Close</button>
        </div>
      </div>`;

    // ---- wire handlers ----
    el.querySelectorAll('[data-mode]').forEach((n) => (n as HTMLElement).onclick = () => { mode = (n as HTMLElement).dataset.mode as 'chips' | 'programs'; render(); });

    if (mode === 'chips') {
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
        addCredits(-u.cost); unlockChip(k); render();
      });
      el.querySelectorAll('[data-pen]').forEach((n) => (n as HTMLElement).onclick = () => { pen = (n as HTMLElement).dataset.pen!; render(); });
      el.querySelectorAll('[data-filt]').forEach((n) => (n as HTMLElement).onclick = () => { filter = (n as HTMLElement).dataset.filt as ChipClass | 'all'; render(); });
      // deck slots
      el.querySelectorAll('[data-slot]').forEach((n) => (n as HTMLElement).onclick = (ev) => {
        const t = ev.target as HTMLElement;
        const i = Number((n as HTMLElement).dataset.slot);
        if (t.dataset.ren) { const name = prompt('Rename deck:', getDeckSlots()[i].name); if (name !== null) { renameDeck(i, name); render(); } return; }
        if (t.dataset.del) { if (confirm('Delete this deck?')) { deleteDeckSlot(i); deck = getDeck().map((e) => ({ ...e })); render(); } return; }
        if (i !== getActiveSlot()) switchSlot(i);
      });
      const addEl = el.querySelector('[data-addslot]') as HTMLElement | null;
      if (addEl) addEl.onclick = () => { setDeck(deck); addDeckSlot(); deck = getDeck().map((e) => ({ ...e })); render(); };
      (el.querySelector('[data-act="reset"]') as HTMLElement).onclick = () => { deck = defaultDeck(); render(); };
    } else {
      el.querySelectorAll('[data-prog]').forEach((n) => (n as HTMLElement).onclick = () => { toggleProgram((n as HTMLElement).dataset.prog!); render(); });
    }

    (el.querySelector('[data-act="cancel"]') as HTMLElement).onclick = () => close(false);
    (el.querySelector('[data-act="save"]') as HTMLElement).onclick = () => { if (validateDeck(deck).ok) close(true); };
  };

  render();
}
