// On-screen touch controls for mobile. Each button synthesizes the SAME keyboard
// events the desktop input layer already consumes (overworld + battle read
// this.keys[code] / keydown), so the game logic needs zero changes.
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
function toggleBtn(label: string, cls: string, code: string): HTMLButtonElement {
  const b = mkBtn(label, cls);
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (held.has(code)) { release(code); b.classList.remove('on'); }
    else { press(code); b.classList.add('on'); }
  });
  return b;
}

let root: HTMLElement | null = null;
let actionsEl: HTMLElement | null = null;
let mode: TouchMode = 'none';

function build() {
  root = document.createElement('div');
  root.id = 'touch-controls';
  document.body.classList.add('touch');

  // D-pad (bottom-left) — cardinal buttons; multi-touch two for diagonals
  const dpad = document.createElement('div');
  dpad.className = 'tc-dpad';
  dpad.appendChild(holdBtn('▲', 'tc-up', 'KeyW'));
  dpad.appendChild(holdBtn('◀', 'tc-left', 'KeyA'));
  dpad.appendChild(holdBtn('▶', 'tc-right', 'KeyD'));
  dpad.appendChild(holdBtn('▼', 'tc-down', 'KeyS'));
  root.appendChild(dpad);

  // Actions (bottom-right) — rebuilt per mode
  actionsEl = document.createElement('div');
  actionsEl.className = 'tc-actions';
  root.appendChild(actionsEl);

  document.body.appendChild(root);
}

function rebuildActions() {
  if (!actionsEl) return;
  actionsEl.innerHTML = '';
  if (mode === 'overworld') {
    actionsEl.appendChild(tapBtn('E', 'tc-a', 'KeyE'));     // interact
    actionsEl.appendChild(tapBtn('⚔', 'tc-b', 'KeyF'));     // duel
    actionsEl.appendChild(toggleBtn('RUN', 'tc-run', 'ShiftLeft'));
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
  mode = m;
  if (root) root.style.display = m === 'none' ? 'none' : 'block';
  rebuildActions();
}
