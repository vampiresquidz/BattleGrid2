import { chromium } from 'playwright';
const b = await chromium.launch({ channel:'chrome', headless:true, args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport:{width:1200,height:780} });
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://localhost:5175/?dev'); await p.waitForTimeout(3200);
await p.click('#ow-settings'); await p.waitForTimeout(250);
const has = await p.evaluate(()=>!!document.querySelector('#vol'));
// set slider to 30 and confirm it persists to localStorage
await p.evaluate(()=>{ const v=document.querySelector('#vol'); v.value='30'; v.dispatchEvent(new Event('input',{bubbles:true})); });
await p.waitForTimeout(100);
const state = await p.evaluate(()=>({ pct: document.querySelector('#vol-pct')?.textContent, stored: localStorage.getItem('abyssal.sfxvol'), ico: document.querySelector('.set-ico')?.textContent }));
// set to 0 -> muted icon
await p.evaluate(()=>{ const v=document.querySelector('#vol'); v.value='0'; v.dispatchEvent(new Event('input',{bubbles:true})); });
const muted = await p.evaluate(()=>({ stored: localStorage.getItem('abyssal.sfxvol'), ico: document.querySelector('.set-ico')?.textContent }));
console.log('slider present:', has, '| at30:', JSON.stringify(state), '| at0:', JSON.stringify(muted));
await p.screenshot({ path:'tools/settings_vol.png' });
console.log(errs.length?'ERR:\n'+errs.join('\n'):'no errors');
await b.close();
