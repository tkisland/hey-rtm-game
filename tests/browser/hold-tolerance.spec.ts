import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {api} from './mock-video';

async function advanceTo(page:Page,time:number) {
  const current=await page.evaluate(()=>(window as any).testVideo.getCurrentTime());
  await page.clock.runFor(Math.round((time-current)*1000));
}

for(const slide of [false,true]) for(const error of [-.22,.22]) test(`${slide?'slide checkpoints and tail':'hold tail'} accept ${error<0?'early':'late'} 220ms input through the game controls`,async({page},info)=>{
  await page.clock.install({time:new Date('2026-10-17T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-17T00:00:01Z'));
  await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
  await page.addInitScript(slide=>{
    localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false}));
    localStorage.setItem('hey-rhythm-custom-chart-v1',JSON.stringify({videoId:'pJDfWpZ7CI4',title:'gentle holds',bpm:120,startTime:10,
      notes:[{id:1,type:'hold',time:10,endTime:13,lane:0,...(slide?{gimmick:'slide',path:[{time:11,lane:5}]}:{})}]}));
  },slide);
  await page.goto('/game.html?chart=custom');
  // Let the async mock API load before advancing its paused onReady timer.
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).testVideo))).toBe(true);
  await page.clock.runFor(100);
  await expect(page.locator('#restart')).toBeEnabled();
  await page.evaluate(()=>{(window as any).testVideo.seekTo(10);(window as any).testVideo.playVideo();});
  await page.clock.runFor(16);
  const touch=info.project.name==='mobile-touch'?await page.context().newCDPSession(page):null;
  const pads=await page.locator('.lane-button').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{id:1,x:r.x+r.width/2,y:r.y+r.height/2};}));
  if(touch) await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pads[0]]});
  else await page.keyboard.down('s');
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('HOLD');
  if(slide) {
    await advanceTo(page,11+error);
    if(touch) await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[pads[5]]});
    else {await page.keyboard.down('l');await page.keyboard.up('s');}
    await expect(page.locator('#judgement-5 .judgement-label')).toHaveText(/推し変|HOLD/);
  }
  await advanceTo(page,13+error);
  await expect(page.locator('#score')).toHaveText('0');
  if(touch) await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  else await page.keyboard.up(slide?'l':'s');
  await expect(page.locator('#score')).toHaveText('300');
  await expect(page.locator('#combo')).toHaveText('1');
  await expect(page.locator('#result h2')).toHaveText('最高なLIVE！');
  await expect(page.locator('#result-counts div').filter({hasText:'GOOD'}).locator('strong')).toHaveText('1');
  await touch?.detach();
});
