import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
// equip HardMem(+40hp), Extra RAM(+1), Quick Draw(opening cannon)
await page.addInitScript(() => {
  localStorage.setItem('abyssal.ow.wins', '20');
  localStorage.setItem('abyssal.navicust', JSON.stringify(['hardmem','extram','quickdraw']));
});
await page.goto('http://localhost:5175/?dev&battle&enemy=0');
await page.waitForFunction(() => !!window.__battle, { timeout: 10000 });
await page.waitForTimeout(700);
const res = await page.evaluate(() => {
  const b = window.__battle;
  return { hpMax: b.playerHPMax, hp: Math.round(b.playerHP), nav: b.nav, queueLen: b.queue.length, queue0: b.queue[0]?.kind };
});
console.log(JSON.stringify(res));
console.log(errors.length ? 'ERRORS:\n'+errors.join('\n') : 'no errors');
await browser.close();
