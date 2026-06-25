import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1320, height: 860 } });
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => {
  localStorage.setItem('abyssal.credits', '3000');
  localStorage.setItem('abyssal.ow.wins', '12');
});
await page.goto('http://localhost:5175/?dev');
await page.waitForTimeout(3200);
await page.keyboard.press('KeyB');
await page.waitForSelector('#deckbuilder', { timeout: 5000 });
await page.waitForTimeout(400);
const info = await page.evaluate(() => ({
  slots: document.querySelectorAll('.db-slot').length,
  analytics: !!document.querySelector('.db-stats'),
  paRows: document.querySelectorAll('.db-parow').length,
  bars: document.querySelectorAll('.db-bar').length,
}));
console.log('CHIPS:', JSON.stringify(info));
await page.screenshot({ path: 'tools/deck_chips.png' });
// switch to PROGRAMS
await page.click('[data-mode="programs"]');
await page.waitForTimeout(300);
const before = await page.locator('.db-memlabel').textContent();
await page.click('.db-card.db-prog'); // toggle first program
await page.waitForTimeout(250);
const after = await page.locator('.db-memlabel').textContent();
const progCount = await page.locator('.db-card.db-prog').count();
console.log('PROGRAMS:', progCount, 'mem before/after:', before.trim(), '/', after.trim());
await page.screenshot({ path: 'tools/deck_programs.png' });
if (errors.length) console.log('ERRORS:\n'+errors.join('\n')); else console.log('no errors');
await browser.close();
