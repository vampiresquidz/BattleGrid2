// Screenshot with a forced body archetype in localStorage.
// Usage: node tools/shoot_body.mjs <url> <out> <body>
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:5173/?dev';
const out = process.argv[3] || 'tools/shot.png';
const body = process.argv[4] || 'monkey';

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

// set localStorage before the app boots, then reload
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.evaluate((b) => localStorage.setItem('abyssal.body', b), body);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.screenshot({ path: out });
console.log('saved', out, 'body=' + body);
if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
await browser.close();
