// Character customiser modal: pick the modular agent's parts & colours with a
// live preview. Persists to localStorage on every change (via setModularConfig)
// and calls onChange so the live game sprite updates behind the modal too.
import {
  getModularConfig, setModularConfig, modularIdleCanvas,
  HELMETS, OUTFITS, SWATCHES, type ModularConfig, type HelmetId, type OutfitId,
} from './modular.ts';

export function openCustomizer(container: HTMLElement, onChange: () => void): void {
  if (document.getElementById('customizer')) return;
  const cfg: ModularConfig = getModularConfig();

  const el = document.createElement('div');
  el.id = 'customizer';
  el.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(4,8,18,.72)';
  el.innerHTML = `
    <div class="roster-panel" style="max-width:560px;width:94%;max-height:92vh;overflow:auto">
      <h2>CUSTOMISE AGENT</h2>
      <div class="sub">Build your modular agent — swap parts & colours. Saves instantly.</div>
      <div id="cz-preview" style="display:flex;gap:14px;justify-content:center;align-items:flex-end;margin:14px 0"></div>
      <div id="cz-controls"></div>
      <button class="btn" data-act="done" style="margin-top:14px">Done · Esc</button>
    </div>`;
  container.appendChild(el);

  const preview = el.querySelector('#cz-preview') as HTMLElement;
  const controls = el.querySelector('#cz-controls') as HTMLElement;

  // ---- live preview: front (big) + side + back ----
  const mkCanvas = (size: number, label: string) => {
    const wrap = document.createElement('div'); wrap.style.cssText = 'text-align:center';
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    cv.style.cssText = `width:${size}px;height:${size}px;image-rendering:pixelated;background:radial-gradient(circle at 50% 40%,#1a2540,#0a0e18);border:1px solid #2c4a7a;border-radius:10px`;
    const cap = document.createElement('div'); cap.className = 'sub'; cap.textContent = label; cap.style.marginTop = '4px';
    wrap.appendChild(cv); wrap.appendChild(cap);
    return { wrap, cv };
  };
  const big = mkCanvas(180, 'FRONT');
  const side = mkCanvas(100, 'SIDE');
  const back = mkCanvas(100, 'BACK');
  preview.append(side.wrap, big.wrap, back.wrap);

  const blit = (cv: HTMLCanvasElement, view: 'front' | 'right' | 'back') => {
    const src = modularIdleCanvas(view, cfg);
    const x = cv.getContext('2d')!; x.imageSmoothingEnabled = false;
    x.clearRect(0, 0, cv.width, cv.height);
    x.drawImage(src, 0, 0, cv.width, cv.height);
  };
  const refresh = () => { blit(big.cv, 'front'); blit(side.cv, 'right'); blit(back.cv, 'back'); };

  const apply = () => { setModularConfig(cfg); refresh(); onChange(); };

  // ---- colour rows ----
  const colorRow = (label: string, key: 'frame' | 'trim' | 'eye' | 'dark') => {
    const row = document.createElement('div'); row.style.cssText = 'margin:10px 0';
    const head = document.createElement('div'); head.className = 'sub';
    head.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = cfg[key];
    inp.style.cssText = 'width:26px;height:22px;border:none;background:none;padding:0;cursor:pointer';
    inp.oninput = () => { cfg[key] = inp.value; apply(); };
    head.append(document.createTextNode(label), inp);
    const sw = document.createElement('div'); sw.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px';
    for (const c of SWATCHES) {
      const b = document.createElement('button');
      b.style.cssText = `width:22px;height:22px;border-radius:5px;border:2px solid ${c === cfg[key] ? '#fff' : '#2c4a7a'};background:${c};cursor:pointer`;
      b.onclick = () => { cfg[key] = c; inp.value = c; apply(); markSwatch(sw, c); };
      b.dataset.c = c;
      sw.appendChild(b);
    }
    row.append(head, sw);
    return row;
  };
  const markSwatch = (sw: HTMLElement, sel: string) => {
    sw.querySelectorAll('button').forEach((b) => {
      (b as HTMLElement).style.borderColor = (b as HTMLElement).dataset.c === sel ? '#fff' : '#2c4a7a';
    });
  };

  // ---- part chip rows ----
  const chipRow = <T extends string>(label: string, items: Array<{ id: T; name: string }>, key: 'helmet' | 'outfit') => {
    const row = document.createElement('div'); row.style.cssText = 'margin:12px 0';
    const head = document.createElement('div'); head.className = 'sub'; head.textContent = label; head.style.marginBottom = '6px';
    const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
    const paint = () => wrap.querySelectorAll('button').forEach((b) => {
      const on = (b as HTMLElement).dataset.id === cfg[key];
      (b as HTMLElement).style.cssText = `padding:6px 12px;border-radius:8px;cursor:pointer;font:600 12px ui-monospace,monospace;` +
        `border:1px solid ${on ? '#67e0ff' : '#2c4a7a'};background:${on ? 'rgba(103,224,255,.16)' : 'rgba(10,16,30,.6)'};color:#dfe9ff`;
    });
    for (const it of items) {
      const b = document.createElement('button'); b.textContent = it.name; b.dataset.id = it.id;
      b.onclick = () => { (cfg[key] as string) = it.id; apply(); paint(); };
      wrap.appendChild(b);
    }
    paint();
    row.append(head, wrap);
    return row;
  };

  // ---- shoulders toggle ----
  const toggleRow = () => {
    const row = document.createElement('div'); row.style.cssText = 'margin:12px 0';
    const b = document.createElement('button'); b.className = 'btn';
    const paint = () => { b.textContent = `Shoulder pads · ${cfg.shoulders ? 'ON' : 'OFF'}`; };
    b.onclick = () => { cfg.shoulders = !cfg.shoulders; apply(); paint(); };
    paint(); row.appendChild(b);
    return row;
  };

  controls.append(
    chipRow('HELMET', HELMETS as Array<{ id: HelmetId; name: string }>, 'helmet'),
    chipRow('OUTFIT', OUTFITS as Array<{ id: OutfitId; name: string }>, 'outfit'),
    toggleRow(),
    colorRow('Frame', 'frame'),
    colorRow('Trim', 'trim'),
    colorRow('Visor', 'eye'),
    colorRow('Outline', 'dark'),
  );

  refresh();

  const close = () => { el.remove(); window.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  window.addEventListener('keydown', onKey);
  (el.querySelector('[data-act="done"]') as HTMLElement).onclick = close;
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
}
