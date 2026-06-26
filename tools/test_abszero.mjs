import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => {
  const reps = [];
  for (let i=0;i<10;i++) { reps.push({kind:'iceshot',code:'I'},{kind:'blizzard',code:'I'},{kind:'icewall',code:'I'}); }
  localStorage.setItem('abyssal.decks', JSON.stringify({ slots:[{name:'ICE',entries:reps}], active:0 }));
});
await page.goto('http://localhost:5175/?dev&battle&enemy=0');
await page.waitForFunction(() => !!window.__battle, { timeout: 12000 });
await page.waitForTimeout(800);
await page.keyboard.press('Space'); // open custom
await page.waitForSelector('.cw-hand', { timeout: 4000 });
await page.waitForTimeout(150);
// click hand cards in recipe order: Cryo Lock -> Flash Freeze -> Heat Sink
const clickByName = async (name) => {
  const ok = await page.evaluate((nm) => {
    const cards = [...document.querySelectorAll('.cw-hand .chipcard')];
    const c = cards.find(el => el.querySelector('.name')?.textContent === nm && !el.classList.contains('selected'));
    if (c) { c.click(); return true; } return false;
  }, name);
  await page.waitForTimeout(120);
  return ok;
};
const a = await clickByName('Cryo Lock');
const b = await clickByName('Flash Freeze');
const c = await clickByName('Heat Sink');
const paHint = await page.locator('.cw-pa').count();
const paText = paHint ? (await page.locator('.cw-pa').textContent()).trim() : '';
await page.screenshot({ path: 'tools/abszero_select.png' });
await page.keyboard.press('Enter'); // confirm
await page.waitForTimeout(150);
const flash = await page.locator('.pa-flash').count();
const flashText = flash ? (await page.locator('.pa-flash').textContent()).trim() : '';
const queued = await page.evaluate(() => window.__battle.queue.map(c=>c.kind+(c.paId?(':'+c.paId):'')));
console.log(JSON.stringify({ selected:[a,b,c], paHint, paText, flash, flashText, queued }));
console.log(errors.length ? 'ERR:\n'+errors.join('\n') : 'no errors');
await browser.close();
