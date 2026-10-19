import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3});
 const api=readFileSync(new URL('../tests/browser/mock-video.ts',import.meta.url),'utf8').match(/export const api = `([\s\S]*?)`;/)[1];
 await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
 await page.addInitScript(()=>{
  localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false}));
  localStorage.setItem('hey-rhythm-custom-chart-v1',JSON.stringify({videoId:'pJDfWpZ7CI4',title:'miss stress',bpm:200,startTime:2,notes:Array.from({length:120},(_,i)=>({id:i+1,time:2+Math.floor(i/6)*.15,lane:i%6,type:'tap'}))}));
  const animate=Element.prototype.animate;
  window.judgeAnimations=0;
  Element.prototype.animate=function(...args){if(this.classList.contains('lane-judgement'))window.judgeAnimations++;return animate.apply(this,args)};
 });
 await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:4190'}/game.html?chart=custom`);await page.locator('#play-start').waitFor({state:'visible'});await page.waitForFunction(()=>!!window.testVideo);
 await page.waitForTimeout(300);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await cdp.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline.stack,blink.user_timing',transferMode:'ReturnAsStream'});
 await page.evaluate(()=>{window.testVideo.seekTo(1.8);window.testVideo.playVideo()});
 await page.waitForTimeout(3600);
 const completed=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');const {stream}=await completed;
 let data='';while(true){const part=await cdp.send('IO.read',{handle:stream});data+=part.data;if(part.eof)break;}await cdp.send('IO.close',{handle:stream});
 const trace=JSON.parse(data).traceEvents;
 const durations=Object.fromEntries(['Layout','UpdateLayoutTree','Paint','FunctionCall'].map(name=>{const events=trace.filter(e=>e.name===name&&e.ph==='X');return[name,{count:events.length,totalMs:events.reduce((s,e)=>s+(e.dur||0),0)/1000,maxMs:Math.max(0,...events.map(e=>e.dur||0))/1000}]}));
 console.log(JSON.stringify({animations:await page.evaluate(()=>window.judgeAnimations),durations}));
 if(process.argv[3])writeFileSync(process.argv[3],data);
 await browser.close();
})();
