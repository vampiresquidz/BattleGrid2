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
  const fire = async (pa, col) => {
    b.enemyHP = 9999; b.enemyHPMax = 9999; b.over = false;
    b.enemyFreezeT = 5; // hold the enemy still
    b.enemyPos = { col, row: b.playerPos.row };
    b.syncEntity(b.enemy, b.enemyPos);
    const before = b.enemyHP;
    b.queue = [{ id:'pa', name:pa, code:'*', kind:'pa', cls:'strike', damage:0, cost:0, icon:'x', desc:'', paId:pa }];
    b.fireChip();
    await new Promise(r => setTimeout(r, 900));
    out[pa] = before - b.enemyHP;
  };
  await fire('lifesaber', b.playerPos.col + 1); // adjacent for the 2x3 blade
  await fire('hyperburst', 6);                  // down the row
  return out;
});
console.log(JSON.stringify(res));
console.log(errors.length ? 'ERRORS:\n'+errors.join('\n') : 'no errors');
await browser.close();
