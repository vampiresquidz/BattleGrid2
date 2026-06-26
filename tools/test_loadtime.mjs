import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
// count image requests under /sprites during the battle load
const reqs = [];
page.on('request', r => { const u=r.url(); if (u.includes('/sprites/')) reqs.push(u.split('/sprites/')[1]); });
const t0 = Date.now();
await page.goto('http://localhost:5175/?dev&battle&enemy=0');
await page.waitForFunction(() => !!window.__battle, { timeout: 15000 });
const tReady = Date.now() - t0;
// wait for loading overlay to be gone
await page.waitForFunction(() => !document.querySelector('.loadscreen'), { timeout: 8000 }).catch(()=>{});
const tGone = Date.now() - t0;
await page.waitForTimeout(400);
await page.screenshot({ path: 'tools/loadtime_battle.png' });
console.log('battle ready at', tReady+'ms; loadscreen gone at', tGone+'ms');
console.log('sprite requests during load:', reqs.length);
console.log(reqs.sort().join('\n'));
console.log(errors.length ? 'ERR:\n'+errors.join('\n') : 'no errors');
await browser.close();
