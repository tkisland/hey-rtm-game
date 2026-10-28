import {test,expect} from '@playwright/test';
import {api} from './mock-video';
import type {Page} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.clock.install({time:new Date('2026-10-17T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-17T00:00:01Z'));
  await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
  await page.addInitScript(()=>{
    localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false}));
    localStorage.setItem('hey-rhythm-custom-chart-v1',JSON.stringify({videoId:'pJDfWpZ7CI4',title:'box',bpm:120,startTime:10,
      notes:Array.from({length:6},(_,lane)=>({id:lane+1,type:'tap',gimmick:'box',boxId:1,time:10+lane*.2,lane}))}));
  });
  await page.goto('/game.html?chart=custom');
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).testVideo))).toBe(true);
  await page.clock.runFor(100);await expect(page.locator('#restart')).toBeEnabled();
});
async function start(page:Page,time:number,upper=false){
  await page.evaluate(time=>{const video=(window as any).testVideo;video.pauseVideo();video.seekTo(time);video.playVideo();},time);
  await page.clock.runFor(32);
  return page.locator('.lane-button').evaluateAll((nodes,upper)=>nodes.map((node,lane)=>{
    const r=node.getBoundingClientRect();return{id:lane<3?1:2,x:r.x+r.width/2,y:upper?r.top+2:r.y+r.height/2};
  }),upper);
}
for(const rightFirst of [false,true])test(`two fingers open outward, ${rightFirst?'right':'left'} central contact first, and score once`,async({page})=>{
  const points=await start(page,10.25),touch=await page.context().newCDPSession(page),url=page.url();
  await page.evaluate(()=>{
    (window as any).swipeDefaults=[];
    for(const type of ['touchstart','touchmove'])document.addEventListener(type,event=>{
      if((event.target as Element).closest('.lane-button'))(window as any).swipeDefaults.push(event.defaultPrevented);
    },{passive:true});
  });
  const central=rightFirst?[points[3],points[2]]:[points[2],points[3]];
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[central[0]]});
  await page.clock.runFor(10);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:central});
  await expect(page.locator('#score')).toHaveText('0');await page.clock.runFor(50);
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[points[0],points[5]]});
  await expect(page.locator('#score')).toHaveText('500,750');await expect(page.locator('#combo')).toHaveText('1');
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect(await page.evaluate(()=>(window as any).swipeDefaults.every(Boolean))).toBe(true);expect(page.url()).toBe(url);
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).overscrollBehaviorX)).toBe('none');
  await page.clock.runFor(1600);
  await expect(page.locator('#result-accuracy')).toContainText('全 1 ノーツ');
  await expect(page.locator('#result-counts div').filter({hasText:'GOOD'}).locator('strong')).toHaveText('1');
  await page.keyboard.press('s');await page.keyboard.press('l');await expect(page.locator('#score')).toHaveText('500,750');await touch.detach();
});
test('one finger and a lifted partial hand cannot complete a box',async({page})=>{
  const points=await start(page,9.95),touch=await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[2],points[3]]});
  await page.clock.runFor(20);await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[points[1],points[3]]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[points[3]]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[points[5]]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[2]]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[points[0]]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.clock.runFor(2200);
  await expect(page.locator('#score')).toHaveText('0');
  await expect(page.locator('#result-counts div').filter({hasText:'MISS'}).locator('strong')).toHaveText('1');await touch.detach();
});
test('F+J then D+K then S+L opens one box using the keyboard',async({page})=>{
  await start(page,9.95);
  for(const pair of [['f','j'],['d','k'],['s','l']]){
    for(const key of pair)await page.keyboard.press(key);
    await page.clock.runFor(30);
  }
  await expect(page.locator('#score')).toHaveText('1,001,500');await expect(page.locator('#combo')).toHaveText('1');
});
test('the extended upper touch area works and keeps the same lower clearance',async({page})=>{
  const points=await start(page,9.95,true);
  const rects=await page.locator('.lane-button').evaluateAll(nodes=>nodes.map(node=>{
    const b=node.getBoundingClientRect(),p=node.parentElement!.getBoundingClientRect();
    const receptor=node.parentElement!.querySelector('.lane-receptor')!.getBoundingClientRect();
    return{extra:p.top-b.top,bottom:b.bottom,parentBottom:p.bottom,top:b.top,receptorBottom:receptor.bottom};
  }));
  for(const r of rects){expect(r.extra).toBeGreaterThan(10);expect(r.extra).toBeLessThanOrEqual(32.1);expect(r.bottom).toBeCloseTo(r.parentBottom,1);expect(r.top-r.receptorBottom).toBeGreaterThanOrEqual(3.9);}
  const touch=await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[2],points[3]]});
  await page.clock.runFor(50);await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[points[0],points[5]]});
  await expect(page.locator('#score')).toHaveText('1,001,500');
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.detach();
});
