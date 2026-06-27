// Daily Ops terminal: the ◊ TIDE hub — clearance level, daily quests (earn),
// and the cosmetic vault (sink). Mirrors the deck builder / shop modal pattern.
import {
  getTide, dayInfo, getClearance, getDailyQuests, claimQuest, rerollQuests, rerollCost,
  COSMETICS, getOwnedCosmetics, mintCosmetic, getEquip, equipCosmetic,
  getNftAsset, recordNftMint, type CosmeticKind,
} from './tide.ts';
import { mintCosmeticNft } from './nft.ts';

const KIND_LABEL: Record<CosmeticKind, string> = { badge: 'Badges', title: 'Titles', color: 'Name Colors' };
const KIND_ORDER: CosmeticKind[] = ['badge', 'title', 'color'];

export function openOps(container: HTMLElement, onClose?: () => void) {
  let tab: 'quests' | 'vault' = 'quests';
  let mintingId: string | null = null; // legendary mint in flight
  let mintMsg = '';                     // last mint error/status

  const el = document.createElement('div');
  el.id = 'opsmodal';
  el.style.cssText = 'position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;background:rgba(4,8,18,.82);font:13px/1.4 ui-monospace,monospace;color:#dfe9ff';
  container.appendChild(el);

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  function close() { el.remove(); document.removeEventListener('keydown', onKey); onClose?.(); }

  const icon = (c: { kind: CosmeticKind; value: string }) =>
    c.kind === 'color' ? `<span class="ops-sw" style="background:${c.value}"></span>`
    : c.kind === 'title' ? '🏷️'
    : c.value; // badge emoji

  const questsHTML = () => {
    const cl = getClearance();
    const di = dayInfo();
    const quests = getDailyQuests();
    const pct = Math.min(100, (di.earned / di.cap) * 100);
    const rows = quests.map((q) => {
      const p = Math.min(100, (q.progress / q.target) * 100);
      const btn = q.claimed ? '<span class="ops-q-done">✓ claimed</span>'
        : q.done ? `<button class="btn ops-claim" data-claim="${q.id}">Claim ◊${q.reward}</button>`
        : `<span class="ops-q-rew">◊${q.reward}</span>`;
      return `<div class="ops-quest${q.hard ? ' hard' : ''}">
        <div class="ops-q-top"><span class="ops-q-desc">${q.desc}${q.hard ? ' <b class="ops-hardtag">HARD</b>' : ''}</span>${btn}</div>
        <div class="ops-q-bar"><div class="ops-q-fill" style="width:${p}%"></div></div>
        <div class="ops-q-prog">${q.progress}/${q.target}</div>
      </div>`;
    }).join('');
    return `
      <div class="ops-capwrap">
        <div class="ops-caprow">
          <span>CLEARANCE <b>CL${cl.level}</b> <span class="db-dim">· earn ×${cl.mult}${cl.nextAt !== null ? ` · next CL at ${cl.nextAt} wins` : ' · MAX'}</span></span>
          <span class="ops-cap">Today ◊${di.earned} / ${di.cap}${di.weekEarned ? `  ·  week ◊${di.weekEarned}/${di.weekCap}` : ''}</span>
        </div>
        <div class="ops-capbar"><div class="ops-capfill" style="width:${pct}%"></div></div>
        <div class="db-dim" style="font-size:11px;margin-top:4px">Higher clearance (from wins) unlocks more &amp; harder quests and a better earn rate. Win bonuses shrink with each win that day.</div>
      </div>
      <div class="ops-sub">DAILY OPS <span class="db-dim">— resets daily</span>
        <button class="btn ops-reroll" data-reroll="1">Reroll all · ◊${rerollCost}</button>
      </div>
      <div class="ops-quests">${rows || '<div class="db-empty">No ops available.</div>'}</div>`;
  };

  const vaultHTML = () => {
    const owned = new Set(getOwnedCosmetics());
    const eq = getEquip();
    const bal = getTide();
    const groups = KIND_ORDER.map((k) => {
      const cards = COSMETICS.filter((c) => c.kind === k).map((c) => {
        const equipped = eq[k] === c.id;
        const ribbon = c.nft ? '<span class="ops-nft" title="Legendary — minted as a real Solana NFT (devnet)">◆ NFT</span>' : '';
        let state: string, attr: string, foot: string;
        if (c.nft) {
          // legendary: minted on-chain (devnet), not bought with ◊
          const asset = getNftAsset(c.id);
          const minting = mintingId === c.id;
          state = equipped ? 'equipped' : asset ? 'owned' : 'buyable';
          attr = minting ? '' : asset ? `data-equip="${c.id}"` : `data-mintnft="${c.id}"`;
          foot = minting ? '⏳ Minting…' : equipped ? '✓ EQUIPPED' : asset ? 'Equip' : 'Mint NFT ◆';
          const link = asset ? `<a class="ops-cos-link" href="https://solscan.io/token/${asset}?cluster=devnet" target="_blank" rel="noopener">view on-chain ↗</a>` : '';
          return `<div class="ops-cos legendary ${state}${minting ? ' minting' : ''}" ${attr}>
            ${ribbon}
            <div class="ops-cos-ic">${icon(c)}</div>
            <div class="ops-cos-name">${c.name.replace(/^(Title|Name Color): /, '')}</div>
            <div class="ops-cos-btn">${foot}</div>${link}
          </div>`;
        }
        const own = owned.has(c.id);
        const afford = bal >= c.price;
        state = equipped ? 'equipped' : own ? 'owned' : afford ? 'buyable' : 'poor';
        attr = own ? `data-equip="${c.id}"` : (afford ? `data-mint="${c.id}"` : '');
        foot = equipped ? '✓ EQUIPPED' : own ? 'Equip' : afford ? `Mint ◊${c.price}` : `◊${c.price}`;
        return `<div class="ops-cos ${state}" ${attr}>
          <div class="ops-cos-ic">${icon(c)}</div>
          <div class="ops-cos-name">${c.name.replace(/^(Title|Name Color): /, '')}</div>
          <div class="ops-cos-btn">${foot}</div>
        </div>`;
      }).join('');
      return `<div class="ops-sub">${KIND_LABEL[k]}</div><div class="ops-cosgrid">${cards}</div>`;
    }).join('');
    return groups;
  };

  const render = () => {
    el.innerHTML = `
      <div class="ops-panel">
        <div class="ops-head">
          <h2>◊ DAILY OPS</h2>
          <div class="ops-tabs">
            <span class="ops-tab${tab === 'quests' ? ' on' : ''}" data-tab="quests">QUESTS</span>
            <span class="ops-tab${tab === 'vault' ? ' on' : ''}" data-tab="vault">VAULT</span>
          </div>
          <div class="ops-bal">◊ ${getTide()}</div>
        </div>
        <div class="ops-body">${tab === 'quests' ? questsHTML() : vaultHTML()}</div>
        <div class="ops-foot">
          <span class="db-dim">${tab === 'quests' ? 'Earn ◊ TIDE by winning. Spend it on cosmetics in the Vault.' : (mintMsg || 'Pure flex — no effect on power. ◆ NFT legendaries mint as real Solana NFTs (devnet) to your wallet.')}</span>
          <span style="flex:1"></span>
          <button class="btn" data-act="close">Close · Esc</button>
        </div>
      </div>`;

    el.querySelectorAll('[data-tab]').forEach((n) => (n as HTMLElement).onclick = () => { tab = (n as HTMLElement).dataset.tab as 'quests' | 'vault'; render(); });
    el.querySelectorAll('[data-claim]').forEach((n) => (n as HTMLElement).onclick = () => { claimQuest((n as HTMLElement).dataset.claim!); render(); });
    const rr = el.querySelector('[data-reroll]') as HTMLElement | null;
    if (rr) rr.onclick = () => { rerollQuests(); render(); };
    el.querySelectorAll('[data-mint]').forEach((n) => (n as HTMLElement).onclick = () => { mintCosmetic((n as HTMLElement).dataset.mint!); render(); });
    el.querySelectorAll('[data-equip]').forEach((n) => (n as HTMLElement).onclick = () => { equipCosmetic((n as HTMLElement).dataset.equip!); render(); });
    el.querySelectorAll('[data-mintnft]').forEach((n) => (n as HTMLElement).onclick = async () => {
      if (mintingId) return; // one at a time
      const id = (n as HTMLElement).dataset.mintnft!;
      mintingId = id; mintMsg = 'Approve the mint in Phantom…'; render();
      try {
        const res = await mintCosmeticNft(id);
        recordNftMint(id, res.asset);
        mintMsg = `✓ Minted on-chain · ${res.asset.slice(0, 4)}…${res.asset.slice(-4)}`;
      } catch (e) {
        mintMsg = '⚠ ' + ((e as Error).message || 'Mint failed.');
      } finally {
        mintingId = null; render();
      }
    });
    (el.querySelector('[data-act="close"]') as HTMLElement).onclick = () => close();
  };

  render();
}
