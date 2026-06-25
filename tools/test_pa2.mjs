import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://localhost:5175/?dev&battle&enemy=0');
await page.waitForFunction(() => !!window.__battle, { timeout: 10000 });
await page.waitForTimeout(700);
const res = await page.evaluate(async () => {
  const b = window.__battle;
  const out = {};
  for (const pa of ['gigacannon','lifesaber','hyperburst','meteorrain']) {
    // align enemy into the player's row & a hittable column
    b.enemyPos = { col: 6, row: b.playerPos.row };
    b.syncEntity(b.enemy, b.enemyPos);
    const before = b.enemyHP;
    b.queue = [{ id:'pa', name:pa, code:'*', kind:'pa', cls:'strike', damage:0, cost:0, icon:'x', desc:'', paId:pa }];
    b.fireChip();
    // let projectiles travel
    await new Promise(r => setTimeout(r, 700));
    out[pa] = before - b.enemyHP;
  }
  return out;
});
console.log(JSON.stringify(res));
console.log(errors.length ? 'ERRORS:\n'+errors.join('\n') : 'no errors');
await browser.close();
