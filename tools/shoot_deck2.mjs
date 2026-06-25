import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => {
  localStorage.setItem('abyssal.credits', '2000');
  localStorage.setItem('abyssal.ow.wins', '8');
});
await page.goto('http://localhost:5175/?dev');
await page.waitForSelector('#overworld, canvas', { timeout: 8000 }).catch(()=>{});
await page.waitForTimeout(3200);
await page.keyboard.press('KeyB');
await page.waitForSelector('#deckbuilder', { timeout: 5000 });
await page.waitForTimeout(400);
// filter to nothing special; scroll the grid to show locked unlockables (sorted last)
await page.evaluate(() => { const g = document.querySelector('.db-grid'); if (g) g.scrollTop = g.scrollHeight; });
await page.waitForTimeout(200);
const counts = await page.evaluate(() => ({
  locked: document.querySelectorAll('.db-card.db-locked').length,
  buyable: document.querySelectorAll('.db-card.db-buyable').length,
  gated: document.querySelectorAll('.db-card.db-gated').length,
  mega: document.querySelectorAll('.db-rar.mega').length,
  giga: document.querySelectorAll('.db-rar.giga').length,
}));
console.log(JSON.stringify(counts));
await page.screenshot({ path: 'tools/deckshot2.png' });
await browser.close();
