import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:5175/?dev';
const out = process.argv[3] || 'tools/loadshot.png';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.goto(url);
await page.waitForTimeout(450); // catch the loadscreen during its minMs floor
const hasLS = await page.locator('.loadscreen').count();
const vidOk = await page.evaluate(() => { const v=document.querySelector('.ls-vid'); return v? {display:getComputedStyle(v).display, w:v.videoWidth, h:v.videoHeight, t:v.currentTime, src:v.src}:null; });
await page.screenshot({ path: out });
console.log('loadscreen present:', hasLS, 'video:', JSON.stringify(vidOk));
if (errors.length) console.log('ERRORS:\n'+errors.join('\n'));
await browser.close();
