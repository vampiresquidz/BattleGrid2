import { chromium } from 'playwright';
const url = 'http://localhost:5175/?dev';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
// seed progression BEFORE the app reads it
await page.addInitScript(() => {
  localStorage.setItem('abyssal.credits', '2000');
  localStorage.setItem('abyssal.ow.wins', '8'); // enough for most, not deltaray(10)/bassgs(15)
});
await page.goto(url);
await page.waitForTimeout(2200); // through loading screen into overworld
await page.keyboard.press('KeyB'); // open deck builder
await page.waitForTimeout(500);
const present = await page.locator('#deckbuilder').count();
const lockedCount = await page.locator('.db-card.db-locked').count();
const buyable = await page.locator('.db-card.db-buyable').count();
const gated = await page.locator('.db-card.db-gated').count();
await page.screenshot({ path: 'tools/deckshot.png' });
console.log(JSON.stringify({ present, lockedCount, buyable, gated }));

// click the first buyable (unlock) and confirm it converts to addable
const cardInfo = await page.evaluate(() => {
  const c = document.querySelector('.db-card.db-buyable');
  return c ? { k: c.getAttribute('data-unlock'), name: c.querySelector('.db-cardname')?.textContent } : null;
});
if (cardInfo) {
  await page.click(`.db-card.db-buyable[data-unlock="${cardInfo.k}"]`);
  await page.waitForTimeout(300);
  const nowAddable = await page.locator(`.db-card[data-add="${cardInfo.k}"]`).count();
  const creditsTxt = await page.locator('.db-wallet').textContent();
  console.log('unlocked', cardInfo.name, 'nowAddable=', nowAddable, 'wallet=', creditsTxt.trim());
}
if (errors.length) console.log('ERRORS:\n'+errors.join('\n'));
await browser.close();
