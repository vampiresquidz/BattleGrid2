import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://localhost:5175/'); // real login screen (no ?dev)
await page.waitForSelector('#login', { timeout: 8000 });
const hasGuestBtn = await page.locator('#guest').count();
await page.click('#guest');
await page.waitForTimeout(3200);
const inGame = await page.evaluate(() => ({
  loginGone: !document.querySelector('#login'),
  tag: document.querySelector('#ow-credits')?.textContent?.trim(),
  tide: document.querySelector('#ow-tide')?.textContent?.replace(/\s+/g,' ').trim(),
  // is localStorage the in-memory shim? real fresh storage would be empty;
  // guest seed gives 500 credits via the shim
  creditsKey: localStorage.getItem('abyssal.credits'),
}));
console.log('GUEST in-game:', JSON.stringify(inGame));
// reload — real localStorage should be restored and EMPTY (nothing saved)
await page.reload();
await page.waitForTimeout(500);
const afterReload = await page.evaluate(() => ({
  backToLogin: !!document.querySelector('#login'),
  realCredits: localStorage.getItem('abyssal.credits'),
  realTide: localStorage.getItem('abyssal.tide'),
}));
console.log('AFTER RELOAD:', JSON.stringify(afterReload));
console.log('guest button present:', hasGuestBtn);
console.log(errors.length ? 'ERR:\n'+errors.join('\n') : 'no errors');
await browser.close();
