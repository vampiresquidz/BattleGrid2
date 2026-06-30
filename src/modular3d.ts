// ---- 3D modular character (PiAPI/Trellis parts) ----
// Loads a part manifest (public/models/parts/<char>/manifest.json) produced by
// tools/gen_modular_char.py, assembles the chosen variant per slot into a single
// THREE.Group mounted at the manifest anchors, and applies a live HUE shift so
// the player can recolour the whole build. Used by the in-game Character Forge
// (3D preview + equip UI) and — later — the overworld player.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface PartVariant { variant: string; png: string; glb?: string }
export interface PartSlot { anchor: [number, number, number]; h: number; variants: PartVariant[] }
export interface Manifest { char: string; desc: string; slots: Record<string, PartSlot> }

// equip = the chosen variant name per slot + a hue rotation (degrees) for colour
// + an optional agent name (Stardew-style character creator).
export interface Equip { slots: Record<string, string>; hue: number; name?: string }

const FORGE_KEY = 'abyssal.forge';
export const MEGA_CHAR = 'mega';

export function getEquip(): Equip {
  try {
    const raw = JSON.parse(localStorage.getItem(FORGE_KEY) || 'null');
    if (raw && typeof raw === 'object') return { slots: {}, hue: 0, ...raw };
  } catch { /* ignore */ }
  return { slots: {}, hue: 0 };
}
export function setEquip(e: Equip): void {
  try { localStorage.setItem(FORGE_KEY, JSON.stringify(e)); } catch { /* ignore */ }
}

const _manifests = new Map<string, Promise<Manifest>>();
export function loadManifest(char = MEGA_CHAR): Promise<Manifest> {
  let m = _manifests.get(char);
  if (!m) { m = fetch(`/models/parts/${char}/manifest.json`).then((r) => r.json()); _manifests.set(char, m); }
  return m;
}

const _loader = new GLTFLoader();
// load a fresh scene each time (the browser HTTP-caches the GLB bytes; a fresh
// parse avoids Object3D.clone() pitfalls on some Trellis hierarchies).
function loadGlb(url: string): Promise<THREE.Object3D> {
  return _loader.loadAsync(url).then((g) => g.scene);
}

// inject a hue-rotation into a material's map sampling so we can recolour the
// baked pixel-art texture live (blue → any hue) while keeping its shading.
// recolour the baked pixel-art via a hue rotation injected into the material.
// We collect the materials into `holder.mats` so the slider can recompile-free
// update the uniform; the shader is injected once per material.
function applyHue(mat: THREE.MeshStandardMaterial, holder: HueHolder) {
  mat.emissive = new THREE.Color(0x223a66);
  mat.emissiveMap = mat.map ?? null;
  mat.emissiveIntensity = 0.5;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHue = { value: holder.value };
    holder.uniforms.push(shader.uniforms.uHue);
    shader.fragmentShader = 'uniform float uHue;\n' + shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       if (abs(uHue) > 0.001) {
         const mat3 toYIQ = mat3(0.299,0.587,0.114, 0.596,-0.274,-0.322, 0.211,-0.523,0.312);
         const mat3 toRGB = mat3(1.0,0.956,0.621, 1.0,-0.272,-0.647, 1.0,-1.106,1.703);
         vec3 yiq = toYIQ * diffuseColor.rgb;
         float hyp = length(yiq.yz); float ang = atan(yiq.z, yiq.y) + uHue;
         yiq.y = hyp*cos(ang); yiq.z = hyp*sin(ang);
         diffuseColor.rgb = clamp(toRGB * yiq, 0.0, 1.0);
       }`);
  };
  mat.needsUpdate = true;
}
interface HueHolder { value: number; uniforms: Array<{ value: number }> }

function fitScale(model: THREE.Object3D, target: number, byMax: boolean) {
  const bb = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3(); bb.getSize(size);
  const d = byMax ? Math.max(size.x, size.y, size.z) : size.y;
  model.scale.setScalar(target / (d || 1));
}

function placePart(model: THREE.Object3D, slotName: string, slot: PartSlot) {
  // body/head define the character's height; held/worn items fit by their
  // largest dimension so a long cannon doesn't blow up when normalized by height
  fitScale(model, slot.h, slotName !== 'body' && slotName !== 'head');
  const bb = new THREE.Box3().setFromObject(model);
  const c = new THREE.Vector3(); bb.getCenter(c);
  const [ax, ay, az] = slot.anchor;
  if (slotName === 'body') model.position.set(-c.x, -bb.min.y, -c.z);          // feet on the floor
  else if (slotName === 'head') model.position.set(ax - c.x, ay - bb.min.y, az - c.z); // neck at anchor.y
  else model.position.set(ax - c.x, ay - c.y, az - c.z);                        // centered at anchor
}

export interface ModularRig {
  group: THREE.Group;
  setSlot: (name: string, variant: string) => Promise<void>;  // reloads only that slot
  setHue: (deg: number) => void;                              // recompile-free recolour
  dispose: () => void;
}

// Build a stateful character rig. Each slot mounts independently so equipping a
// new part only reloads THAT part (not the whole character). Missing/!glb
// variants are skipped, so it degrades gracefully while assets generate.
export async function createRig(char: string, equip: Equip): Promise<ModularRig> {
  const manifest = await loadManifest(char);
  const group = new THREE.Group();
  const hue: HueHolder = { value: (equip.hue || 0) * Math.PI / 180, uniforms: [] };
  const mounted: Record<string, THREE.Object3D> = {};

  const setSlot = async (name: string, variant: string) => {
    const slot = manifest.slots[name];
    if (!slot) return;
    const v = slot.variants.find((x) => x.variant === variant) ?? slot.variants[0];
    if (mounted[name]) { group.remove(mounted[name]); delete mounted[name]; }
    if (!v?.glb) return;
    const model = await loadGlb(v.glb);
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) applyHue(m as THREE.MeshStandardMaterial, hue);
    });
    placePart(model, name, slot);
    model.userData.slot = name;
    mounted[name] = model; group.add(model);
  };

  // initial mount (sequential — keeps headless/GPU load gentle)
  for (const name of Object.keys(manifest.slots)) {
    await setSlot(name, equip.slots[name] ?? manifest.slots[name].variants[0].variant);
  }

  return {
    group, setSlot,
    setHue: (deg: number) => { hue.value = deg * Math.PI / 180; for (const u of hue.uniforms) u.value = hue.value; },
    dispose: () => { for (const k of Object.keys(mounted)) group.remove(mounted[k]); },
  };
}
