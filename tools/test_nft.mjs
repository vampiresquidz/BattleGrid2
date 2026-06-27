import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => { localStorage.setItem('abyssal.ow.wins','40'); });
await page.goto('http://localhost:5175/?dev');
await page.waitForTimeout(3200);
await page.keyboard.press('KeyT');
await page.waitForSelector('#opsmodal', { timeout: 5000 });
await page.click('[data-tab="vault"]');
await page.waitForTimeout(250);
const before = await page.evaluate(() => ({
  mintNftBtns: document.querySelectorAll('[data-mintnft]').length,
  ribbons: document.querySelectorAll('.ops-nft').length,
}));
console.log('vault:', JSON.stringify(before));
// click a Mint NFT button — no real Phantom in headless → expect graceful error
await page.click('[data-mintnft="b_crown"]');
await page.waitForTimeout(1200);
const foot = await page.evaluate(() => document.querySelector('.ops-foot .db-dim')?.textContent?.trim());
console.log('after click footer:', JSON.stringify(foot));
await page.screenshot({ path: 'tools/ops_nft.png' });
console.log(errors.length ? 'ERR:\n'+errors.join('\n') : 'no page errors');
await browser.close();
