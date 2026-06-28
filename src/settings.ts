// Settings menu: sound, app install (mobile only), and account/log-out.
import { isMuted, setMuted, playSfx } from './sfx.ts';
import { isMobile } from './walletMobile.ts';
import { canInstallPrompt, promptInstall, isStandalone, isIOS } from './pwa.ts';
import type { Session } from './wallet.ts';

export function openSettings(container: HTMLElement, session: Session, onClose?: () => void) {
  const el = document.createElement('div');
  el.id = 'settings';
  el.style.cssText = 'position:fixed;inset:0;z-index:85;display:flex;align-items:center;justify-content:center;background:rgba(4,8,18,.82);font:13px/1.5 ui-monospace,monospace;color:#dfe9ff';
  container.appendChild(el);

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  function close() { el.remove(); document.removeEventListener('keydown', onKey); onClose?.(); }

  const render = () => {
    // Install row — only meaningful on mobile (hidden on desktop).
    let installRow = '';
    if (isStandalone()) {
      installRow = `<div class="set-row"><span>App</span><span class="set-val">✓ Installed</span></div>`;
    } else if (isMobile()) {
      if (canInstallPrompt()) {
        installRow = `<div class="set-row"><span>Install app</span><button class="btn set-btn" data-act="install">⤓ Install</button></div>`;
      } else if (isIOS()) {
        installRow = `<div class="set-row set-col"><span>Install app</span><span class="set-hint">In Safari: tap <b>Share</b> → <b>Add to Home Screen</b>.</span></div>`;
      } else {
        installRow = `<div class="set-row set-col"><span>Install app</span><span class="set-hint">Use your browser menu → <b>Install app / Add to Home screen</b>.</span></div>`;
      }
    }

    const acct = session.address === 'guest' ? 'Guest (nothing saved)' : session.short;

    el.innerHTML = `
      <div class="set-panel">
        <div class="set-head"><h2>SETTINGS</h2></div>
        <div class="set-body">
          <div class="set-row">
            <span>Sound effects</span>
            <button class="btn set-btn" data-act="sound">${isMuted() ? '🔇 Off' : '🔊 On'}</button>
          </div>
          ${installRow}
          <div class="set-row"><span>Account</span><span class="set-val">${acct}</span></div>
          <div class="set-row"><span></span><button class="btn set-btn" data-act="logout">Log out</button></div>
        </div>
        <div class="set-foot">
          <span class="set-hint">Abyssal Grid</span><span style="flex:1"></span>
          <button class="btn" data-act="close">Close · Esc</button>
        </div>
      </div>`;

    (el.querySelector('[data-act="sound"]') as HTMLElement).onclick = () => { const m = !isMuted(); setMuted(m); if (!m) playSfx('ui_click', 0.4); render(); };
    const inst = el.querySelector('[data-act="install"]') as HTMLElement | null;
    if (inst) inst.onclick = async () => { await promptInstall(); render(); };
    (el.querySelector('[data-act="logout"]') as HTMLElement).onclick = () => { location.href = location.pathname; };
    (el.querySelector('[data-act="close"]') as HTMLElement).onclick = () => close();
  };
  render();
}
