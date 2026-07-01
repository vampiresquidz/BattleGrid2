// Character customiser for the 2D modular pixel hero (the 'custom' agent).
// A live pixel preview + a HELMET cycle (swappable gpt-generated layer) + a
// COLOUR hue slider. Persists to hero2d config and calls onChange so the live
// overworld/battle sprite updates.
import { getHeroConfig, setHeroConfig, heroCanvas, HELMETS, type HeroConfig } from './hero2d.ts';

export function openCustomizer(container: HTMLElement, onChange: () => void): void {
  if (document.getElementById('customizer')) return;
  const cfg: HeroConfig = getHeroConfig();

  const el = document.createElement('div');
  el.id = 'customizer';
  el.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(4,8,18,.72)';
  el.innerHTML = `
    <div class="roster-panel" style="max-width:520px;width:94%;max-height:92vh;overflow:auto">
      <h2>CUSTOMISE AGENT</h2>
      <div class="sub">Swap the helmet layer and recolour your pixel hero. Saves instantly.</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;margin-top:14px">
        <div style="flex:0 0 auto"><canvas id="cz-prev" width="200" height="200"
          style="width:200px;height:200px;image-rendering:pixelated;background:radial-gradient(circle at 50% 40%,#1a2540,#0a0e18);border:1px solid #2c4a7a;border-radius:12px"></canvas></div>
        <div id="cz-controls" style="flex:1 1 220px;min-width:200px"></div>
      </div>
      <button class="btn" data-act="done" style="margin-top:14px">Done · Esc</button>
    </div>`;
  container.appendChild(el);
  const controls = el.querySelector('#cz-controls') as HTMLElement;
  const prev = el.querySelector('#cz-prev') as HTMLCanvasElement;
  const pctx = prev.getContext('2d')!;

  const apply = () => { setHeroConfig(cfg); onChange(); };

  // "LABEL  ‹ value ›" cycle row
  const cycleRow = (label: string, value: string, onStep: (d: number) => void) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0;background:rgba(10,16,30,.55);border:1px solid #25406e;border-radius:9px;padding:6px 8px';
    const lab = document.createElement('div'); lab.textContent = label;
    lab.style.cssText = 'font:600 12px ui-monospace,monospace;color:#9cc6ff;min-width:64px';
    const arrow = (t: string, d: number) => { const b = document.createElement('button'); b.textContent = t; b.style.cssText = 'background:rgba(103,224,255,.12);border:1px solid #3a6f9f;border-radius:7px;color:#cfe6ff;cursor:pointer;font:700 14px ui-monospace,monospace;padding:2px 10px'; b.onclick = () => onStep(d); return b; };
    const val = document.createElement('div'); val.textContent = value;
    val.style.cssText = 'flex:1;text-align:center;font:600 13px ui-monospace,monospace;color:#eaf3ff';
    row.append(lab, arrow('‹', -1), val, arrow('›', 1)); return row;
  };

  const render = () => {
    controls.innerHTML = '';
    // helmet cycle
    const hi = Math.max(0, HELMETS.findIndex((h) => h.id === cfg.helmet));
    controls.appendChild(cycleRow('HELMET', HELMETS[hi]?.name ?? 'Standard', (d) => {
      cfg.helmet = HELMETS[(hi + d + HELMETS.length) % HELMETS.length].id; apply(); render();
    }));
    // colour hue slider
    const hueRow = document.createElement('div'); hueRow.style.cssText = 'margin:12px 0';
    const hl = document.createElement('div'); hl.className = 'sub'; hl.textContent = 'SUIT COLOUR'; hl.style.marginBottom = '6px';
    const sl = document.createElement('input'); sl.type = 'range'; sl.min = '0'; sl.max = '360'; sl.value = String(cfg.hue || 0);
    sl.style.cssText = 'width:100%;accent-color:#67e0ff;background:linear-gradient(90deg,#39d0ff,#9b5cff,#ff2d95,#ffb020,#aaff36,#39d0ff);height:10px;border-radius:6px';
    sl.oninput = () => { cfg.hue = parseInt(sl.value, 10); apply(); };
    hueRow.append(hl, sl); controls.appendChild(hueRow);
  };
  render();

  // live preview (rAF so it fills in once the layer PNGs load)
  let raf = 0;
  const loop = () => { raf = requestAnimationFrame(loop); const src = heroCanvas(cfg); pctx.imageSmoothingEnabled = false; pctx.clearRect(0, 0, 200, 200); pctx.drawImage(src, 0, 0, 200, 200); };
  loop();

  const close = () => { cancelAnimationFrame(raf); el.remove(); window.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  window.addEventListener('keydown', onKey);
  (el.querySelector('[data-act="done"]') as HTMLElement).onclick = close;
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
}
