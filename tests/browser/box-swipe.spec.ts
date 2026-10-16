import {test,expect} from '@playwright/test';
import {api} from './mock-video';
import type {Page} from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.clock.install({time:new Date('2026-10-16T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-16T00:00:01Z'));
  await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
  await page.addInitScript(() => {
    localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false}));
    // A legacy staggered chart still represents one box at its first timestamp.
    localStorage.setItem('hey-rhythm-custom-chart-v1',JSON.stringify({videoId:'pJDfWpZ7CI4',title:'box',bpm:120,startTime:10,
      notes:Array.from({length:6},(_,lane)=>({id:lane+1,type:'tap',gimmick:'box',boxId:1,time:10+lane*.2,lane}))}));
  });
  await page.goto('/game.html?chart=custom');await page.clock.runFor(100);
  await expect(page.locator('#restart')).toBeEnabled();await expect(page.locator('#chart-info')).toContainText('1 NOTES');
  await page.locator('.lane-buttons').evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));
  await page.clock.runFor(32);
});
async function start(page:Page,time:number) {
  await page.evaluate(time=>{const video=(window as any).testVideo;video.pauseVideo();video.seekTo(time);video.playVideo();},time);
  await page.clock.runFor(32);
  return Promise.all(Array.from({length:6},async(_,lane)=>{const r=(await page.locator('.lane-button').nth(lane).boundingBox())!;return {id:1,x:r.x+r.width/2,y:r.y+r.height/2};}));
}
for(const reverse of [false,true]) test(`real game scores one late ${reverse?'right-to-left':'left-to-right'} fast swipe exactly once`,async({page})=>{
  const points=await start(page,10.25),touch=await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[reverse?5:0]]});
  await expect(page.locator('#score')).toHaveText('0');
  await page.clock.runFor(50);
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[points[reverse?0:5]]});
  await expect(page.locator('#score')).toHaveText('300');await expect(page.locator('#combo')).toHaveText('1');
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('#result-accuracy')).toContainText('全 1 ノーツ');
  await expect(page.locator('#result-counts div').filter({hasText:'GOOD'}).locator('strong')).toHaveText('1');
  await page.keyboard.press('s');await page.keyboard.press('l');await expect(page.locator('#score')).toHaveText('300');await touch.detach();
});
test('releasing halfway cannot stitch two gestures together and only one MISS is counted',async({page})=>{
  const points=await start(page,9.95),touch=await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[0]]});await page.clock.runFor(30);
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[points[2]]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[3]]});await page.clock.runFor(30);
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[points[5]]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.clock.runFor(600);
  await expect(page.locator('#score')).toHaveText('0');
  await expect(page.locator('#result-counts div').filter({hasText:'MISS'}).locator('strong')).toHaveText('1');
  await expect(page.locator('#result-accuracy')).toContainText('全 1 ノーツ');await touch.detach();
});
