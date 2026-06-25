import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1320, height: 860 } });
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => {
  localStorage.setItem('abyssal.credits', '2000');
  localStorage.setItem('abyssal.ow.wins', '8');
  localStorage.setItem('abyssal.ow.pos', JSON.stringify({ x: 10.4, z: -2 })); // beside the merchant (11,-2)
});
await page.goto('http://localhost:5175/?dev');
await page.waitForTimeout(3300);
await page.keyboard.press('KeyE'); // interact with nearest actor (the merchant)
await page.waitForTimeout(500);
const present = await page.locator('#chipshop').count();
console.log('shop present:', present);
if (present) {
  const info = await page.evaluate(() => ({
    stock: document.querySelectorAll('.shop-card').length,
    deals: document.querySelectorAll('.shop-deals .shop-card').length,
    buyable: document.querySelectorAll('.shop-card[data-buy]').length,
    dealBadges: document.querySelectorAll('.shop-deal').length,
  }));
  console.log('SHOP:', JSON.stringify(info));
  await page.screenshot({ path: 'tools/shop.png' });
  const card = await page.evaluate(() => document.querySelector('.shop-card[data-buy]')?.getAttribute('data-buy') || null);
  if (card) {
    const before = await page.locator('#chipshop .db-wallet').textContent();
    await page.click(`.shop-card[data-buy="${card}"]`);
    await page.waitForTimeout(250);
    const after = await page.locator('#chipshop .db-wallet').textContent();
    const nowOwned = await page.evaluate((k) => !!document.querySelector(`.shop-card.owned`), card);
    console.log('bought', card, '| wallet', before.trim(), '->', after.trim());
  }
}
console.log(errors.filter(e=>!e.includes('WebSocket')).length ? 'ERRORS:\n'+errors.filter(e=>!e.includes('WebSocket')).join('\n') : 'no errors (ignoring WS)');
await browser.close();
