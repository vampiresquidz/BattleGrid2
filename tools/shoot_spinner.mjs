import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://localhost:5175/?dev');
await page.waitForTimeout(500);
const info = await page.evaluate(() => {
  const v = document.querySelector('.ls-spinvid');
  return v ? { w: v.videoWidth, h: v.videoHeight, src: v.src, blend: getComputedStyle(v).mixBlendMode, t: v.currentTime } : null;
});
console.log('spinner:', JSON.stringify(info));
await page.screenshot({ path: 'tools/spinner_on_screen.png' });
console.log(errors.length ? 'ERR:\n'+errors.join('\n') : 'no errors');
await browser.close();
