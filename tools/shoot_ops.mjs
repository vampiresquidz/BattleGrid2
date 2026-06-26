import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => {
  localStorage.setItem('abyssal.ow.wins','40'); // CL6
  const day = Math.floor(Date.now()/86400000), wk = Math.floor(day/7);
  localStorage.setItem('abyssal.tide', JSON.stringify({ active:'DEV', wallets:{ DEV:{
    balance:320, dayStamp:day, earnedToday:18, weekStamp:wk, earnedWeek:18,
    winsToday:2, battlesToday:3, flawlessToday:1, streak:2, bestStreakToday:2,
    claimed:[], rerollSeed:0, owned:[], equip:{} } } }));
});
await page.goto('http://localhost:5175/?dev');
await page.waitForTimeout(3200);
await page.keyboard.press('KeyT');
await page.waitForSelector('#opsmodal', { timeout: 5000 });
await page.waitForTimeout(300);
const q = await page.evaluate(() => ({ quests: document.querySelectorAll('.ops-quest').length, cap: !!document.querySelector('.ops-capbar'), bal: document.querySelector('.ops-bal')?.textContent?.trim() }));
console.log('QUESTS tab:', JSON.stringify(q));
await page.screenshot({ path: 'tools/ops_quests.png' });
await page.click('[data-tab="vault"]');
await page.waitForTimeout(250);
const v = await page.evaluate(() => ({ cosmetics: document.querySelectorAll('.ops-cos').length }));
console.log('VAULT tab:', JSON.stringify(v));
await page.screenshot({ path: 'tools/ops_vault.png' });
console.log(errors.length ? 'ERR:\n'+errors.join('\n') : 'no errors');
await browser.close();
