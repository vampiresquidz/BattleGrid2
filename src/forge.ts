// Character Forge — a Stardew-style character creator for the modular Mega Man
// build (pattern from the layered paper-doll tutorial: a live preview + one
// "< value >" cycle row per attribute + Randomize + Create/Back). The 3D rig
// (modular3d.ts) is our reliable equivalent of aligned sprite layers: each slot
// mounts at a shared anchor, so swapping a part just swaps that layer.
import * as THREE from 'three';
import { createRig, loadManifest, getEquip, setEquip, MEGA_CHAR, type ModularRig, type Manifest } from './modular3d.ts';

// colour presets cycled by the COLOUR row (hue = rotation applied to the blue base)
const COLOURS: Array<{ name: string; hue: number }> = [
  { name: 'Mega Blue', hue: 0 }, { name: 'Aqua', hue: 150 }, { name: 'Verdant', hue: 110 },
  { name: 'Royal', hue: 60 }, { name: 'Magenta', hue: 90 }, { name: 'Crimson', hue: 170 },
  { name: 'Amber', hue: 200 }, { name: 'Violet', hue: 40 },
];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function openForge(container: HTMLElement, onChange?: () => void, char = MEGA_CHAR): Promise<void> {
  if (document.getElementById('forge')) return;
  let manifest: Manifest | null = null;
  try { manifest = await loadManifest(char); } catch { /* assets may be missing */ }

  const el = document.createElement('div');
  el.id = 'forge';
  el.style.cssText = 'position:fixed;inset:0;z-index:62;display:flex;align-items:center;justify-content:center;background:rgba(4,8,18,.74)';
  el.innerHTML = `
    <div class="roster-panel" style="max-width:660px;width:94%;max-height:92vh;overflow:auto">
      <h2>CHARACTER CREATOR</h2>
      <div class="sub">Cycle each part, recolour the suit, then Create your agent.</div>
      <div style="display:flex;align-items:center;gap:8px;margin:12px 0 4px">
        <label class="sub" style="margin:0">NAME</label>
        <input id="fg-name" maxlength="16" placeholder="Agent"
          style="flex:1;background:rgba(8,14,26,.8);border:1px solid #2c4a7a;border-radius:8px;color:#eaf3ff;padding:8px 10px;font:600 14px ui-monospace,monospace" />
      </div>
      <div id="fg-stage" style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;margin-top:6px">
        <div id="fg-view" style="flex:1 1 280px;min-width:260px"></div>
        <div id="fg-controls" style="flex:1 1 280px;min-width:240px"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn" data-act="rand" style="flex:0 0 auto">🎲 Randomise</button>
        <button class="btn" data-act="create" style="flex:1">Create · Esc</button>
      </div>
    </div>`;
  container.appendChild(el);
  const viewBox = el.querySelector('#fg-view') as HTMLElement;
  const controls = el.querySelector('#fg-controls') as HTMLElement;
  const nameInput = el.querySelector('#fg-name') as HTMLInputElement;

  if (!manifest) {
    viewBox.innerHTML = '<div class="sub" style="padding:30px 0;text-align:center">3D parts are still generating — check back in a few minutes.</div>';
  }

  // ---- mini 3D preview ----
  const W = 300, H = 340;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.domElement.style.cssText = 'width:100%;max-width:300px;border-radius:12px;background:radial-gradient(circle at 50% 38%,#16243f,#070b14)';
  viewBox.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
  cam.position.set(0, 1.5, 5.4);
  scene.add(new THREE.AmbientLight(0x99bbff, 1.15));
  const k = new THREE.PointLight(0x9fd8ff, 36, 30); k.position.set(4, 6, 5); scene.add(k);
  const p = new THREE.PointLight(0xff7ad0, 22, 30); p.position.set(-5, 3, 3); scene.add(p);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.5, 40),
    new THREE.MeshStandardMaterial({ color: 0x101826, emissive: 0x163a5a, emissiveIntensity: 0.5, metalness: 0.4, roughness: 0.5 }));
  disc.rotation.x = -Math.PI / 2; scene.add(disc);
  const root = new THREE.Group(); scene.add(root);

  const equip = getEquip();
  nameInput.value = equip.name ?? '';
  nameInput.oninput = () => { equip.name = nameInput.value.trim(); setEquip(equip); onChange?.(); };
  let rig: ModularRig | null = null;
  let dragging = false, lastX = 0, yaw = 0;

  const note = document.createElement('div'); note.className = 'sub';
  note.style.cssText = 'text-align:center;margin-top:6px';
  viewBox.appendChild(note);

  const build = async () => {
    if (!manifest) return;
    note.textContent = 'assembling…';
    try {
      rig = await createRig(char, equip);
      rig.setHue(equip.hue);
      root.add(rig.group);
      note.textContent = 'drag to spin';
    } catch (e) {
      note.textContent = 'failed to load 3D parts';
      console.error('[forge] assemble failed', e);
    }
  };
  // equip a single slot variant without rebuilding the whole character
  const swap = async (name: string, variant: string) => {
    if (!rig) return;
    note.textContent = 'equipping…';
    try { await rig.setSlot(name, variant); note.textContent = 'drag to spin'; }
    catch (e) { note.textContent = 'failed'; console.error('[forge] swap failed', e); }
  };

  // a "LABEL  < value >" cycle row (the tutorial's per-attribute selector)
  const cycleRow = (label: string, value: string, onStep: (dir: number) => void) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0;background:rgba(10,16,30,.55);border:1px solid #25406e;border-radius:9px;padding:6px 8px';
    const lab = document.createElement('div'); lab.textContent = label;
    lab.style.cssText = 'font:600 12px ui-monospace,monospace;color:#9cc6ff;letter-spacing:.05em;min-width:64px';
    const mid = document.createElement('div');
    mid.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:space-between;gap:6px';
    const arrow = (txt: string, dir: number) => {
      const b = document.createElement('button'); b.textContent = txt;
      b.style.cssText = 'background:rgba(103,224,255,.12);border:1px solid #3a6f9f;border-radius:7px;color:#cfe6ff;cursor:pointer;font:700 14px ui-monospace,monospace;padding:2px 10px';
      b.onclick = () => onStep(dir); return b;
    };
    const val = document.createElement('div'); val.textContent = value;
    val.style.cssText = 'flex:1;text-align:center;font:600 13px ui-monospace,monospace;color:#eaf3ff;text-transform:capitalize';
    mid.append(arrow('‹', -1), val, arrow('›', 1));
    row.append(lab, mid); return row;
  };

  const renderControls = () => {
    if (!manifest) return;
    controls.innerHTML = '';
    // one cycle row per multi-variant slot (skip single-variant body)
    for (const [name, slot] of Object.entries(manifest.slots)) {
      if (slot.variants.length < 2) continue;
      const cur = equip.slots[name] ?? slot.variants[0].variant;
      const idx = Math.max(0, slot.variants.findIndex((v) => v.variant === cur));
      const step = async (dir: number) => {
        const next = slot.variants[(idx + dir + slot.variants.length) % slot.variants.length];
        equip.slots[name] = next.variant; setEquip(equip); renderControls(); await swap(name, next.variant); onChange?.();
      };
      controls.appendChild(cycleRow(name.toUpperCase(), cap(slot.variants[idx].variant), step));
    }
    // colour cycle row
    const ci = Math.max(0, COLOURS.findIndex((c) => c.hue === (equip.hue || 0)));
    const stepColour = (dir: number) => {
      const c = COLOURS[(ci + dir + COLOURS.length) % COLOURS.length];
      equip.hue = c.hue; rig?.setHue(c.hue); setEquip(equip); renderControls(); onChange?.();
    };
    controls.appendChild(cycleRow('COLOUR', COLOURS[ci]?.name ?? 'Custom', stepColour));
  };
  renderControls();

  // randomise every attribute + colour (sequential swaps keep GPU load gentle)
  const randomise = async () => {
    if (!manifest) return;
    for (const [name, slot] of Object.entries(manifest.slots)) {
      if (slot.variants.length < 2) continue;
      equip.slots[name] = slot.variants[(Math.random() * slot.variants.length) | 0].variant;
    }
    equip.hue = COLOURS[(Math.random() * COLOURS.length) | 0].hue;
    setEquip(equip); renderControls();
    for (const [name] of Object.entries(manifest.slots)) {
      if (manifest.slots[name].variants.length < 2) continue;
      await swap(name, equip.slots[name]);
    }
    rig?.setHue(equip.hue); onChange?.();
  };

  // drag to spin
  renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  function onMove(e: PointerEvent) { if (dragging) { yaw += (e.clientX - lastX) * 0.01; lastX = e.clientX; } }
  function onUp() { dragging = false; }

  let raf = 0, t = 0;
  const loop = () => { raf = requestAnimationFrame(loop); t += 0.01; root.rotation.y = dragging ? yaw : yaw + Math.sin(t) * 0.5; cam.lookAt(0, 1.05, 0); renderer.render(scene, cam); };
  loop();
  void build();   // load + assemble the parts (fills in once GLBs land)

  const close = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey);
    renderer.dispose();
    el.remove();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  window.addEventListener('keydown', onKey);
  (el.querySelector('[data-act="create"]') as HTMLElement).onclick = () => { setEquip(equip); onChange?.(); close(); };
  (el.querySelector('[data-act="rand"]') as HTMLElement).onclick = () => { void randomise(); };
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
}
