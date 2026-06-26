// Reusable loading screen: a Seedance-animated background + progress bar, shown
// at startup, before a battle, and when returning to the overworld. The screen
// lasts exactly as long as the asset preload takes (with a small floor so it
// never flashes), so its duration is data-driven, not a hardcoded guess.
import { preloadImages } from './loader.ts';

interface Opts { minMs?: number; title?: string; label?: string }

export async function runLoading(container: HTMLElement, urls: string[], opts: Opts = {}): Promise<number> {
  const { minMs = 300, title = 'ABYSSAL&nbsp;GRID', label = 'Loading assets…' } = opts;

  const el = document.createElement('div');
  el.className = 'loadscreen';
  el.innerHTML = `
    <video class="ls-vid" autoplay loop muted playsinline></video>
    <div class="ls-grad"></div>
    <div class="ls-mid">
      <div class="ls-spin">
        <video class="ls-spinvid" autoplay loop muted playsinline></video>
        <div class="ls-spinfallback"></div>
      </div>
      <div class="ls-title">${title}</div>
      <div class="ls-label">${label}</div>
      <div class="ls-bar"><div class="ls-fill"></div></div>
      <div class="ls-pct">0%</div>
    </div>`;
  container.appendChild(el);

  // Seedance clip if present; otherwise the animated CSS gradient shows through.
  const vid = el.querySelector('.ls-vid') as HTMLVideoElement;
  vid.onerror = () => { vid.style.display = 'none'; };
  vid.src = '/loading.mp4';
  vid.play?.().catch(() => { /* autoplay may be blocked; gradient covers it */ });

  // Seedance spinner (glow on black → screen-blended). Falls back to a CSS ring.
  const spin = el.querySelector('.ls-spinvid') as HTMLVideoElement;
  spin.onerror = () => { spin.style.display = 'none'; el.querySelector('.ls-spinfallback')?.classList.add('show'); };
  spin.src = '/spinner.mp4';
  spin.play?.().catch(() => { /* autoplay blocked; the still frame still reads */ });

  const fill = el.querySelector('.ls-fill') as HTMLElement;
  const pct = el.querySelector('.ls-pct') as HTMLElement;

  const floor = new Promise<void>((r) => setTimeout(r, minMs));
  const ms = await preloadImages(urls, (done, total) => {
    const p = total ? done / total : 1;
    fill.style.width = (p * 100).toFixed(0) + '%';
    pct.textContent = Math.round(p * 100) + '%';
  });
  await floor; // don't flash for cache-hit instant loads

  el.classList.add('ls-done');
  await new Promise<void>((r) => setTimeout(r, 200)); // fade out
  el.remove();
  return ms; // measured real load time (ms) — caller may log it
}
