import { chromium } from 'playwright';
const b = await chromium.launch({ channel:'chrome', headless:true, args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport:{width:412,height:844}, isMobile:true, hasTouch:true,
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://localhost:5175/'); await p.waitForSelector('#login'); await p.waitForTimeout(300);
const ui = await p.evaluate(()=>({
  connect: document.querySelector('#connect')?.textContent,
  wc: !!document.querySelector('#wc'),
  guest: !!document.querySelector('#guest'),
  hint: document.querySelector('.hint')?.textContent?.trim(),
}));
console.log('MOBILE LOGIN:', JSON.stringify(ui));
await p.screenshot({ path:'tools/mobile_login.png' });
console.log(errs.length?'ERR:\n'+errs.join('\n'):'no errors');
await b.close();
