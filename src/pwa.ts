// PWA plumbing: register the service worker and capture the install prompt so the
// Settings menu can offer "Install" where it's actually useful (mobile). No
// floating button — install lives in Settings.
let deferred: { prompt: () => void; userChoice?: Promise<unknown> } | null = null;

export function initPwa() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as unknown as typeof deferred; });
  window.addEventListener('appinstalled', () => { deferred = null; });
}

export function canInstallPrompt(): boolean { return !!deferred; }
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  deferred.prompt();
  try { await deferred.userChoice; } catch { /* ignore */ }
  deferred = null;
  return true;
}
export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}
export function isIOS(): boolean { return /iPhone|iPad|iPod/i.test(navigator.userAgent); }
