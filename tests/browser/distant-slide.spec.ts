import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {api} from './mock-video';

test.beforeEach(async ({page}) => {
  await page.clock.install({time:new Date('2026-10-16T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-16T00:00:01Z'));
  await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
  await page.addInitScript(() => {
    document.addEventListener('pointermove',event=>{ (window as any).lastPointerX=event.clientX; });
    localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false}));
    localStorage.setItem('hey-rhythm-custom-chart-v1',JSON.stringify({videoId:'pJDfWpZ7CI4',title:'distant slide',bpm:120,startTime:10,notes:[
      {id:1,type:'hold',gimmick:'slide',time:10,endTime:13,lane:4,path:[{time:11,lane:0}]},
      {id:2,type:'tap',time:11,lane:2},
    ]}));
  });
  await page.goto('/game.html?chart=custom'); await page.clock.runFor(100);
  await expect(page.locator('#restart')).toBeEnabled();
  await expect(page.locator('#chart-info')).toContainText('2 NOTES');
  await page.locator('.lane-buttons').evaluate(node=>node.scrollIntoView({block:'center',behavior:'instant'}));
  await page.evaluate(()=>{const video=(window as any).testVideo;video.pauseVideo();video.seekTo(9.98);video.playVideo();});
  await page.clock.runFor(32);
});
async function advanceTo(page:Page,time:number) {
  const current=await page.evaluate(()=>(window as any).testVideo.getCurrentTime());
  await page.clock.runFor(Math.max(0,Math.round((time-current)*1000)));
}
async function touchControls(page:Page) {
  const session=await page.context().newCDPSession(page);
  const points=await Promise.all(Array.from({length:6},async(_,lane)=>{
    const r=(await page.locator('.lane-button').nth(lane).boundingBox())!;
    return {id:1,x:r.x+r.width/2,y:r.y+r.height/2};
  }));
  const move = async (lane:number) => {
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[points[lane]]});
    // Native touch events may be coalesced independently of the simulated song clock.
    await expect.poll(()=>page.evaluate(()=>(window as any).lastPointerX)).toBe(points[lane].x);
  };
  return {session,points,move};
}
test('one captured finger crosses intermediate pads without releasing or tapping their notes',async({page})=>{
  const {session,points,move}=await touchControls(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[4]]});
  await page.clock.runFor(16);
  await expect(page.locator('.lane-button').nth(4)).toHaveClass(/holding/);
  await advanceTo(page,10.95);
  for(const lane of [3,2,1]) {
    await move(lane);
    await expect(page.locator('.lane-button').nth(4)).toHaveClass(/holding/);
    await expect(page.locator('#score')).toHaveText('0'); await page.clock.runFor(20);
  }
  await move(0);
  await page.clock.runFor(16);
  await expect(page.locator('.lane-button').nth(0)).toHaveClass(/holding/);
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText(/オシ変！|HOLD/);
  await advanceTo(page,13);
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('#score')).toHaveText('1,000');
  await page.clock.runFor(1600);
  await expect(page.locator('#result-counts div').filter({hasText:'MISS'}).locator('strong')).toHaveText('1');
  await session.detach();
});
test('lifting the finger between distant pads fails the slide',async({page})=>{
  const {session,points,move}=await touchControls(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[4]]});
  await advanceTo(page,10.95);
  await move(2);
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('#judgement-4 .judgement-label')).toHaveText('MISS');
  await advanceTo(page,11);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[0]]});
  await advanceTo(page,13); await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('#score')).toHaveText('0'); await session.detach();
});
test('keyboard transfers directly between distant keys and scores at the final release',async({page})=>{
  await page.keyboard.down('k'); await advanceTo(page,11);
  await page.keyboard.down('s'); await page.keyboard.up('k');
  await page.clock.runFor(16);
  await expect(page.locator('.lane-button').nth(0)).toHaveClass(/holding/);
  await advanceTo(page,13); await page.keyboard.up('s');
  await expect(page.locator('#score')).toHaveText('1,000');
});
