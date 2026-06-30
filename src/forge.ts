// Character Forge: an in-game 3D customiser for the modular Mega Man build.
// Rotating 3D preview + per-slot equip buttons (helmet / weapon / pack) + a hue
// slider to recolour the whole suit. Persists the equip config (modular3d.ts).
import * as THREE from 'three';
import { createRig, loadManifest, getEquip, setEquip, MEGA_CHAR, type ModularRig, type Manifest } from './modular3d.ts';

export async function openForge(container: HTMLElement, onChange?: () => void, char = MEGA_CHAR): Promise<void> {
  if (document.getElementById('forge')) return;
  let manifest: Manifest | null = null;
  try { manifest = await loadManifest(char); } catch { /* assets may be missing */ }

  const el = document.createElement('div');
  el.id = 'forge';
  el.style.cssText = 'position:fixed;inset:0;z-index:62;display:flex;align-items:center;justify-content:center;background:rgba(4,8,18,.74)';
  el.innerHTML = `
    <div class="roster-panel" style="max-width:680px;width:94%;max-height:92vh;overflow:auto">
      <h2>CHARACTER FORGE</h2>
      <div class="sub">Equip AI-generated parts and recolour your agent. Saves instantly.</div>
      <div id="fg-stage" style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;margin-top:12px">
        <div id="fg-view" style="flex:1 1 280px;min-width:260px"></div>
        <div id="fg-controls" style="flex:1 1 280px;min-width:240px"></div>
      </div>
      <button class="btn" data-act="done" style="margin-top:14px">Done · Esc</button>
    </div>`;
  container.appendChild(el);
  const viewBox = el.querySelector('#fg-view') as HTMLElement;
  const controls = el.querySelector('#fg-controls') as HTMLElement;

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

  // ---- controls: per-slot variant chips (skip the single-variant body) ----
  const renderControls = () => {
    if (!manifest) return;
    controls.innerHTML = '';
    for (const [name, slot] of Object.entries(manifest.slots)) {
      if (slot.variants.length < 2) continue; // body etc.
      const row = document.createElement('div'); row.style.cssText = 'margin:4px 0 12px';
      const head = document.createElement('div'); head.className = 'sub';
      head.textContent = name.toUpperCase(); head.style.marginBottom = '6px';
      const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
      const cur = equip.slots[name] ?? slot.variants[0].variant;
      for (const v of slot.variants) {
        const on = v.variant === cur;
        const b = document.createElement('button');
        b.textContent = v.variant;
        b.style.cssText = `padding:6px 12px;border-radius:8px;cursor:pointer;font:600 12px ui-monospace,monospace;text-transform:capitalize;` +
          `border:1px solid ${on ? '#67e0ff' : '#2c4a7a'};background:${on ? 'rgba(103,224,255,.16)' : 'rgba(10,16,30,.6)'};color:#dfe9ff`;
        b.onclick = async () => { equip.slots[name] = v.variant; setEquip(equip); renderControls(); await swap(name, v.variant); onChange?.(); };
        wrap.appendChild(b);
      }
      row.append(head, wrap); controls.appendChild(row);
    }
    // hue slider
    const hueRow = document.createElement('div'); hueRow.style.cssText = 'margin:10px 0';
    const hl = document.createElement('div'); hl.className = 'sub'; hl.textContent = 'SUIT COLOUR'; hl.style.marginBottom = '6px';
    const sl = document.createElement('input'); sl.type = 'range'; sl.min = '0'; sl.max = '360'; sl.value = String(equip.hue || 0);
    sl.style.cssText = 'width:100%;accent-color:#67e0ff;background:linear-gradient(90deg,#39d0ff,#9b5cff,#ff2d95,#ffb020,#aaff36,#39d0ff);height:10px;border-radius:6px';
    sl.oninput = () => { equip.hue = parseInt(sl.value, 10); rig?.setHue(equip.hue); setEquip(equip); onChange?.(); };
    hueRow.append(hl, sl); controls.appendChild(hueRow);
  };
  renderControls();

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
  (el.querySelector('[data-act="done"]') as HTMLElement).onclick = close;
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
}
