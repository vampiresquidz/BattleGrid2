import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => {
  localStorage.setItem('abyssal.ow.wins','64');
  const day = Math.floor(Date.now()/86400000), wk = Math.floor(day/7);
  localStorage.setItem('abyssal.tide', JSON.stringify({ active:'DEV', wallets:{ DEV:{
    balance:500, dayStamp:day, earnedToday:0, weekStamp:wk, earnedWeek:0,
    winsToday:0, battlesToday:0, flawlessToday:0, streak:0, bestStreakToday:0,
    claimed:[], rerollSeed:0, owned:[], equip:{} } } }));
});
await page.goto('http://localhost:5175/?dev');
await page.waitForFunction(() => !!window.__tide, { timeout: 10000 });
const res = await page.evaluate(() => {
  const t = window.__tide; t.initTide('DEV');
  const b0 = t.getTide();
  const m1 = t.mintCosmetic('b_skull'); // 90 badge, auto-equips
  const m2 = t.mintCosmetic('t_tempest'); // 150 title, auto-equips
  const b1 = t.getTide();
  return { b0, m1, m2, b1, equip: t.getEquip(), badge: t.equippedBadge(), title: t.equippedTitle(), decorated: t.decorateName('Neo'), owned: t.getOwnedCosmetics() };
});
console.log(JSON.stringify(res));
console.log(errors.length ? 'ERR:\n'+errors.join('\n') : 'no errors');
await browser.close();
