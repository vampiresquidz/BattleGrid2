// Headless screenshot of the running game (dev-bypass URL) for visual QA.
// Usage: node tools/shoot.mjs [url] [outfile]
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5173/?dev';
const out = process.argv[3] || 'tools/shot.png';
const wait = Number(process.argv[4] || 2500);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: 'networkidle' });
const hold = (process.argv[5] || '').split(',').filter(Boolean); // keys to hold down
for (const k of hold) await page.keyboard.down(k);
const mouse = process.argv[7]; // 'lefthold' | 'left' | 'right' — held through the shot
if (mouse) {
  await page.mouse.move(640, 360);
  if (mouse === 'lefthold') await page.mouse.down({ button: 'left' });
  else await page.mouse.click(640, 360, { button: mouse === 'right' ? 'right' : 'left' });
}
await page.waitForTimeout(wait); // let textures load + a few frames render
// optional: tap a key right before the shot to catch a transient animation (e.g. attack lunge)
const tap = process.argv[6];
if (tap) { await page.keyboard.press(tap); await page.waitForTimeout(130); }
await page.screenshot({ path: out }); // shoot while keys are still held (catches walk/move)
for (const k of hold) await page.keyboard.up(k);
console.log('saved', out);
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
await browser.close();
