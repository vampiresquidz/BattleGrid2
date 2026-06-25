import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
// deck of 30 Logic Bolts (cannon), code A → opening hand is all cannons
await page.addInitScript(() => {
  const entries = Array.from({length:30}, () => ({ kind:'cannon', code:'A' }));
  localStorage.setItem('abyssal.decks', JSON.stringify({ slots:[{name:'PA',entries}], active:0 }));
});
await page.goto('http://localhost:5175/?dev&battle&enemy=0');
await page.waitForFunction(() => !!window.__battle, { timeout: 10000 });
await page.waitForTimeout(900);
// open custom window
await page.keyboard.press('Space');
await page.waitForSelector('.cw-hand', { timeout: 4000 });
await page.waitForTimeout(200);
// select 3 cannons
await page.keyboard.press('Digit1');
await page.keyboard.press('Digit2');
await page.keyboard.press('Digit3');
await page.waitForTimeout(200);
const paHint = await page.locator('.cw-pa').count();
const paHintText = paHint ? (await page.locator('.cw-pa').textContent()).trim() : '';
await page.screenshot({ path: 'tools/pa_select.png' });
// confirm → should fire PA and flash
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
const flash = await page.locator('.pa-flash').count();
const flashText = flash ? (await page.locator('.pa-flash').textContent()).trim() : '';
// the pa chip is now queued; fire it (KeyK)
const enemyBefore = await page.evaluate(() => window.__battle.enemyHP);
await page.keyboard.press('KeyK');
await page.waitForTimeout(600);
const enemyAfter = await page.evaluate(() => window.__battle.enemyHP);
console.log(JSON.stringify({ paHint, paHintText, flash, flashText, enemyBefore, enemyAfter, dmg: enemyBefore-enemyAfter }));
if (errors.length) console.log('ERRORS:\n'+errors.join('\n')); else console.log('no errors');
await browser.close();
