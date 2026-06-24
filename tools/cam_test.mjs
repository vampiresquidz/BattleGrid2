// Verify overworld orbit camera: wheel zoom + click-drag rotate.
import { chromium } from 'playwright';
const out = process.argv[2] || 'tools/cam.png';
const wheel = Number(process.argv[3] || 0);   // +out / -in
const dragX = Number(process.argv[4] || 0);
const dragY = Number(process.argv[5] || 0);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5173/?dev', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
if (wheel) { await page.mouse.move(640, 360); await page.mouse.wheel(0, wheel); await page.waitForTimeout(300); }
if (dragX || dragY) {
  await page.mouse.move(640, 360); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(640 + dragX * i / 10, 360 + dragY * i / 10); await page.waitForTimeout(16); }
  await page.mouse.up();
}
await page.waitForTimeout(400);
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
