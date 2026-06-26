import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => { localStorage.setItem('abyssal.ow.wins','64'); }); // CL8
await page.goto('http://localhost:5175/?dev');
await page.waitForFunction(() => !!window.__tide, { timeout: 10000 });
const res = await page.evaluate(() => {
  const t = window.__tide;
  t.initTide('TESTER');
  const cl = t.getClearance();
  // simulate a day of PvE wins; cap should hold at 50
  let total = 0, perWin = [];
  for (let i=0;i<30;i++){ const e = t.recordBattle(true, i%2===0); total += e; if (i<6) perWin.push(e); }
  const di = t.dayInfo();
  // spend test
  const beforeBal = t.getTide();
  const minted = t.mintCosmetic('b_wave'); // 60
  const afterBal = t.getTide();
  const equip = t.getEquip();
  const quests = t.getDailyQuests().map(q=>({id:q.id,done:q.done,reward:q.reward}));
  return { cl, perWin, totalEarnedFromWins: total, earnedToday: di.earned, cap: di.cap, remaining: di.remaining,
           minted, beforeBal, afterBal, equip, decorated: t.decorateName('DEV'), quests };
});
console.log(JSON.stringify(res, null, 1));
console.log(errors.length ? 'ERR:\n'+errors.join('\n') : 'no errors');
await browser.close();
