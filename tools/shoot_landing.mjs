import { chromium } from 'playwright';
const b = await chromium.launch({ channel:'chrome', headless:true, args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'] });
const errs=[];
const shot = async (label, opts) => {
  const ctx = await b.newContext(opts); const p = await ctx.newPage();
  p.on('pageerror',e=>errs.push(label+': '+e));
  await p.goto('http://localhost:5175/'); await p.waitForSelector('#login'); await p.waitForTimeout(900);
  const info = await p.evaluate(()=>({ bg: !!document.querySelector('.landing-bg'), bgW: document.querySelector('.landing-bg')?.videoWidth, menu: document.querySelectorAll('.menu-btn').length, social: !!document.querySelector('.social-btn') }));
  console.log(label, JSON.stringify(info));
  await p.screenshot({ path:`tools/landing_${label}.png` }); await ctx.close();
};
await shot('desktop', { viewport:{width:1440,height:810} });
await shot('mobile', { viewport:{width:412,height:844}, isMobile:true, hasTouch:true });
console.log(errs.length?'ERR:\n'+errs.join('\n'):'no errors');
await b.close();
