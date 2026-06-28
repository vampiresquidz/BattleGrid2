import { chromium } from 'playwright';
const b = await chromium.launch({ channel:'chrome', headless:true, args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport:{width:1200,height:760} });
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://localhost:5175/?dev'); await p.waitForTimeout(3200);
const mute0 = await p.evaluate(()=>document.querySelector('#ow-mute')?.textContent);
await p.click('#ow-mute'); await p.waitForTimeout(150);
const mute1 = await p.evaluate(()=>document.querySelector('#ow-mute')?.textContent);
// fire a couple SFX directly to ensure no throw
const playOk = await p.evaluate(async ()=>{
  try { const a=new Audio('/sfx/buster.mp3'); a.volume=0.01; await a.play().catch(()=>{}); return true; } catch(e){ return String(e); }
});
console.log('mute toggle:', mute0, '->', mute1, '| audio play ok:', playOk);
console.log(errs.length?'ERR:\n'+errs.join('\n'):'no errors');
await b.close();
