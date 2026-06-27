import { chromium, devices } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
// emulate a landscape phone with touch
const ctx = await browser.newContext({ viewport: { width: 880, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
// OVERWORLD
await page.goto('http://localhost:5175/?dev');
await page.waitForTimeout(3200);
const ow = await page.evaluate(() => ({
  touchRoot: !!document.querySelector('#touch-controls'),
  visible: document.querySelector('#touch-controls') ? getComputedStyle(document.querySelector('#touch-controls')).display : 'none',
  dpad: document.querySelectorAll('.tc-dpad .tc-btn').length,
  actions: [...document.querySelectorAll('.tc-actions .tc-btn')].map(b=>b.textContent),
  bodyTouch: document.body.classList.contains('touch'),
}));
console.log('OVERWORLD:', JSON.stringify(ow));
// press the right dpad button → should dispatch KeyD (move). Verify no error + key dispatch observed
const moved = await page.evaluate(async () => {
  let got = false; const h = (e)=>{ if(e.code==='KeyD') got=true; };
  window.addEventListener('keydown', h);
  const b = document.querySelector('.tc-right'); b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
  await new Promise(r=>setTimeout(r,60));
  b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
  window.removeEventListener('keydown', h);
  return got;
});
console.log('dpad right dispatches KeyD:', moved);
await page.screenshot({ path: 'tools/mobile_overworld.png' });
// BATTLE
await page.goto('http://localhost:5175/?dev&battle&enemy=0');
await page.waitForTimeout(2600);
const bt = await page.evaluate(() => ({
  visible: document.querySelector('#touch-controls') ? getComputedStyle(document.querySelector('#touch-controls')).display : 'none',
  actions: [...document.querySelectorAll('.tc-actions .tc-btn')].map(b=>b.textContent),
}));
console.log('BATTLE:', JSON.stringify(bt));
await page.screenshot({ path: 'tools/mobile_battle.png' });
console.log(errors.length ? 'ERR:\n'+errors.join('\n') : 'no errors');
await browser.close();
