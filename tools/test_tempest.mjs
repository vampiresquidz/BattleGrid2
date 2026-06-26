import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => {
  const reps = [];
  for (let i=0;i<10;i++) reps.push({kind:'galeshot',code:'W'},{kind:'cyclone',code:'W'},{kind:'windwall',code:'W'});
  localStorage.setItem('abyssal.decks', JSON.stringify({ slots:[{name:'WIND',entries:reps}], active:0 }));
});
await page.goto('http://localhost:5175/?dev&battle&enemy=0');
await page.waitForFunction(() => !!window.__battle, { timeout: 12000 });
await page.waitForTimeout(800);
await page.keyboard.press('Space');
await page.waitForSelector('.cw-hand', { timeout: 4000 });
await page.waitForTimeout(150);
const clickByName = async (name) => { const ok = await page.evaluate((nm) => {
  const c=[...document.querySelectorAll('.cw-hand .chipcard')].find(el=>el.querySelector('.name')?.textContent===nm && !el.classList.contains('selected'));
  if(c){c.click();return true;}return false;}, name); await page.waitForTimeout(120); return ok; };
const a=await clickByName('Gale Force'), b=await clickByName('Cyclone'), c=await clickByName('Air Filter');
const paText = (await page.locator('.cw-pa').count()) ? (await page.locator('.cw-pa').textContent()).trim() : '';
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
const flashText = (await page.locator('.pa-flash').count()) ? (await page.locator('.pa-flash').textContent()).trim() : '';
const queued = await page.evaluate(() => window.__battle.queue.map(c=>c.kind+(c.paId?(':'+c.paId):'')));
console.log(JSON.stringify({ selected:[a,b,c], paText, flashText, queued }));
console.log(errors.length ? 'ERR:\n'+errors.join('\n') : 'no errors');
await browser.close();
