// On-screen touch controls for mobile. Movement is a VIRTUAL JOYSTICK (drag
// anywhere in the bottom-left zone) that maps the stick angle to the SAME WASD
// keyboard events the desktop input layer already consumes — so the game logic
// needs zero changes. Pushing the stick to the rim auto-runs (Shift). Actions
// are tap/hold buttons on the right, rebuilt per scene.
export type TouchMode = 'none' | 'overworld' | 'battle';

export function isTouch(): boolean {
  const coarse = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  return coarse && Math.min(window.innerWidth, window.innerHeight) < 1024;
}

const held = new Set<string>();
const KEYCHAR: Record<string, string> = {
  KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyJ: 'j', KeyK: 'k', KeyE: 'e', KeyF: 'f', Space: ' ', ShiftLeft: 'Shift',
};
function emit(type: 'keydown' | 'keyup', code: string) {
  window.dispatchEvent(new KeyboardEvent(type, { code, key: KEYCHAR[code] || code, bubbles: true }));
}
function press(code: string) { if (!held.has(code)) { held.add(code); emit('keydown', code); } }
function release(code: string) { if (held.has(code)) { held.delete(code); emit('keyup', code); } }
function releaseAll() { for (const c of [...held]) release(c); }
function tap(code: string) { emit('keydown', code); setTimeout(() => emit('keyup', code), 50); }

// ---------- buttons ----------
function mkBtn(label: string, cls: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'tc-btn ' + cls;
  b.innerHTML = label;
  b.tabIndex = -1;
  return b;
}
function holdBtn(label: string, cls: string, code: string): HTMLButtonElement {
  const b = mkBtn(label, cls);
  const down = (e: Event) => { e.preventDefault(); b.classList.add('on'); press(code); };
  const up = (e: Event) => { e.preventDefault(); b.classList.remove('on'); release(code); };
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointerleave', up);
  b.addEventListener('pointercancel', up);
  return b;
}
function tapBtn(label: string, cls: string, code: string): HTMLButtonElement {
  const b = mkBtn(label, cls);
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('on'); tap(code); });
  b.addEventListener('pointerup', () => b.classList.remove('on'));
  b.addEventListener('pointerleave', () => b.classList.remove('on'));
  return b;
}

// ---------- virtual joystick ----------
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft'];
let zone: HTMLElement | null = null;   // the touch capture area (bottom-left)
let base: HTMLElement | null = null;   // joystick ring (re-centers under the thumb)
let knob: HTMLElement | null = null;
let joyId = -1;                        // active pointerId
let baseX = 0, baseY = 0;
const RADIUS = 56;                     // px the knob travels before clamping
const DEAD = 0.30;                     // fraction of radius that registers no move
const RUN = 0.92;                      // fraction past which we auto-run

function setMoveKeys(dx: number, dy: number, dist: number) {
  const want = new Set<string>();
  if (dist > RADIUS * DEAD) {
    const nx = dx / dist, ny = dy / dist;
    if (nx > 0.38) want.add('KeyD'); else if (nx < -0.38) want.add('KeyA');
    if (ny > 0.38) want.add('KeyS'); else if (ny < -0.38) want.add('KeyW');
    if (dist > RADIUS * RUN) want.add('ShiftLeft');
  }
  for (const k of MOVE_KEYS) { if (want.has(k)) press(k); else release(k); }
}

function showStick(x: number, y: number) {
  if (!base || !knob) return;
  baseX = x; baseY = y;
  base.style.left = x + 'px'; base.style.top = y + 'px';
  knob.style.left = x + 'px'; knob.style.top = y + 'px';
  base.style.opacity = '1';
}
function moveStick(x: number, y: number) {
  if (!knob) return;
  let dx = x - baseX, dy = y - baseY;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const cl = Math.min(dist, RADIUS);
  knob.style.left = (baseX + (dx / dist) * cl) + 'px';
  knob.style.top = (baseY + (dy / dist) * cl) + 'px';
  setMoveKeys(dx, dy, dist);
}
function endStick() {
  joyId = -1;
  for (const k of MOVE_KEYS) release(k);
  if (base) base.style.opacity = '0.5';
  if (base && knob) { knob.style.left = base.style.left; knob.style.top = base.style.top; }
}

function buildJoystick(root: HTMLElement) {
  zone = document.createElement('div');
  zone.className = 'tc-joyzone';
  // base + knob live on the root (fixed inset:0) so their left/top are viewport
  // coords — matching the clientX/Y we position them with.
  base = document.createElement('div'); base.className = 'tc-joy-base';
  knob = document.createElement('div'); knob.className = 'tc-joy-knob';
  root.appendChild(zone);
  root.appendChild(base); root.appendChild(knob);
  zone.addEventListener('pointerdown', (e) => {
    if (joyId !== -1) return;
    e.preventDefault();
    joyId = e.pointerId;
    zone!.setPointerCapture?.(e.pointerId);
    showStick(e.clientX, e.clientY);   // dynamic: stick appears under the thumb
    moveStick(e.clientX, e.clientY);
  });
  zone.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) { e.preventDefault(); moveStick(e.clientX, e.clientY); } });
  const up = (e: PointerEvent) => { if (e.pointerId === joyId) { e.preventDefault(); endStick(); } };
  zone.addEventListener('pointerup', up);
  zone.addEventListener('pointercancel', up);
  zone.addEventListener('pointerleave', up);
}

// ---------- root ----------
let root: HTMLElement | null = null;
let actionsEl: HTMLElement | null = null;
let mode: TouchMode = 'none';

function build() {
  root = document.createElement('div');
  root.id = 'touch-controls';
  document.body.classList.add('touch');

  buildJoystick(root);                  // movement: drag joystick (bottom-left)

  actionsEl = document.createElement('div');
  actionsEl.className = 'tc-actions';
  root.appendChild(actionsEl);

  document.body.appendChild(root);
}

function rebuildActions() {
  if (!actionsEl) return;
  actionsEl.innerHTML = '';
  if (mode === 'overworld') {
    actionsEl.appendChild(tapBtn('E', 'tc-a', 'KeyE'));     // interact / enter
    actionsEl.appendChild(tapBtn('⚔', 'tc-b', 'KeyF'));     // duel
  } else if (mode === 'battle') {
    actionsEl.appendChild(tapBtn('CHIP', 'tc-chip', 'Space'));   // open custom window
    actionsEl.appendChild(tapBtn('▶', 'tc-fire', 'KeyK'));        // fire queued chip
    actionsEl.appendChild(holdBtn('●', 'tc-buster', 'KeyJ'));     // tap = shot, hold = charge
  }
}

// Show the right controls for the current scene (call from main.ts transitions).
export function setTouchMode(m: TouchMode) {
  if (!isTouch()) return;
  if (!root) build();
  releaseAll();
  endStick();
  mode = m;
  if (root) root.style.display = m === 'none' ? 'none' : 'block';
  rebuildActions();
}
