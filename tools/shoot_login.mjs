import { chromium } from 'playwright';
const b = await chromium.launch({ channel:'chrome', headless:true, args:['--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport:{width:1100,height:760} });
await p.goto('http://localhost:5175/'); await p.waitForSelector('#login'); await p.waitForTimeout(300);
await p.screenshot({ path:'tools/login_guest.png' }); await b.close();
