import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://localhost:5175/?dev&battle&enemy=0');
await page.waitForFunction(() => !!window.__battle, { timeout: 10000 });
await page.waitForTimeout(800);
const kinds = ['antidmg','holy','muramasa','snake','geddon','lifesword','timebomb','roll','deltaray','bassgs'];
const result = await page.evaluate((kinds) => {
  const b = window.__battle;
  const out = [];
  for (const kind of kinds) {
    try {
      const d = b.drawPile?.[0] || {};
      // craft a minimal chip from CHIP_DEFS via a fake queue entry
      const chip = { id: kind+'-test', name: kind, code: 'A', kind, cls: 'strike', damage: 80, cost: 2, icon: '?', desc: '' };
      b.queue = [chip];
      b.fireChip();
      out.push(kind + ':ok');
    } catch (e) {
      out.push(kind + ':ERR ' + (e.message||e));
    }
  }
  return out;
}, kinds);
console.log(result.join('\n'));
await page.waitForTimeout(400);
if (errors.length) console.log('PAGE ERRORS:\n'+errors.join('\n')); else console.log('no page errors');
await browser.close();
