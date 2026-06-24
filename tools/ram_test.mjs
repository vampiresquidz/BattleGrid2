import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:5173/?dev&battle&enemy=0', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.keyboard.press('Space');     // open custom
await page.waitForTimeout(250);
await page.keyboard.press('Digit1');    // select card 1 (Cannon A)
await page.waitForTimeout(150);
await page.keyboard.press('Digit6');    // select card 6 (Cannon * -> combos -> discount)
await page.waitForTimeout(300);
await page.screenshot({ path: 'tools/shot_ram_combo.png' });
console.log('saved');
await browser.close();
