import { chromium } from 'playwright';
const b = await chromium.launch({ channel:'chrome', headless:true, args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const errs=[];
async function run(label, ctxOpts){
  const ctx = await b.newContext(ctxOpts);
  const p = await ctx.newPage();
  p.on('pageerror',e=>errs.push(label+': '+e));
  await p.goto('http://localhost:5175/?dev'); await p.waitForTimeout(3200);
  const hasGear = await p.locator('#ow-settings').count();
  await p.click('#ow-settings'); await p.waitForTimeout(300);
  const info = await p.evaluate(()=>({
    open: !!document.querySelector('#settings'),
    rows: [...document.querySelectorAll('.set-row > span:first-child')].map(s=>s.textContent).filter(Boolean),
    hasInstall: !!document.querySelector('[data-act="install"]') || [...document.querySelectorAll('.set-row')].some(r=>/Install app/.test(r.textContent||'')),
    floatingInstall: !!document.querySelector('#pwa-install'),
  }));
  console.log(label, 'gear='+hasGear, JSON.stringify(info));
  await p.screenshot({ path:`tools/settings_${label}.png` });
  await ctx.close();
}
await run('desktop', { viewport:{width:1200,height:780} });
await run('mobile', { viewport:{width:412,height:844}, isMobile:true, hasTouch:true, userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' });
console.log(errs.length?'ERR:\n'+errs.join('\n'):'no errors');
await b.close();
