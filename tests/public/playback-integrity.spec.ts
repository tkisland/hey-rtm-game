import {test,expect} from '@playwright/test';
import {api} from '../browser/mock-video';

test.beforeEach(async({page})=>{
  await page.clock.install({time:new Date('2026-10-18T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-18T00:00:01Z'));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.addInitScript(()=>localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false})));
  await page.goto('/game.html');
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).testVideo))).toBe(true);
  await page.clock.runFor(100);await expect(page.locator('#restart')).toBeEnabled();
});

test('a full SMG005 play with repeated one-second rendering gaps retains the hit and counts every note',async({page})=>{
  await page.evaluate(()=>(window as any).testVideo.playVideo());
  await page.clock.runFor(7650);
  await page.keyboard.press('l');
  await expect(page.locator('#score')).toHaveText('1,960');
  for(let second=0;second<211;second++)await page.clock.fastForward(1000);
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result-score')).toHaveText('1,960');
  await expect(page.locator('#result-counts div').filter({hasText:'PERFECT'}).locator('strong')).toHaveText('1');
  await expect(page.locator('#result-counts div').filter({hasText:'MISS'}).locator('strong')).toHaveText('509');
  await expect(page.locator('#result-accuracy')).toContainText('判定済み 510');
  await expect(page.locator('#result-accuracy')).toContainText('スキップ 0 / 全 510');
  await page.evaluate(()=>(window as any).testVideo.setState(0));
  await page.getByRole('button',{name:'もういちど遊ぶ',exact:true}).click();
  await page.clock.runFor(32);
  await expect(page.locator('#result')).not.toBeVisible();
  await expect(page.locator('#show-result')).not.toBeVisible();
  await expect(page.locator('#score')).toHaveText('0');
  await expect(page.locator('#combo')).toHaveText('0');
  await expect.poll(()=>page.evaluate(()=>(window as any).testVideo.getCurrentTime())).toBeLessThan(.1);
  await expect.poll(()=>page.evaluate(()=>(window as any).testVideo.getPlayerState())).toBe(1);
  await page.clock.runFor(7618);
  await page.keyboard.press('l');
  await expect(page.locator('#score')).toHaveText('1,960');
});

test('normal 750ms iframe updates move visible notes on every rendered frame after learning the cadence',async({page})=>{
  await page.evaluate(()=>{const video=(window as any).testVideo;video.updateInterval=.75;video.playVideo();});
  await page.clock.runFor(5250);
  await page.evaluate(()=>{
    const proto=CanvasRenderingContext2D.prototype,original=proto.roundRect;
    const samples:{at:number;y:number}[]=[];
    (window as any).motionSamples=samples;(window as any).restoreMotion=()=>{proto.roundRect=original;};
    proto.roundRect=function(...args){
      if(this.canvas.id==='game-canvas'&&Number(args[3])<=Number(args[2])&&Number(args[3])>0){
        const at=performance.now();if(samples.at(-1)?.at!==at)samples.push({at,y:Number(args[1])});
      }
      return original.apply(this,args);
    };
  });
  try {
    await page.clock.runFor(700);
    const samples=await page.evaluate(()=>(window as any).motionSamples as {at:number;y:number}[]);
    expect(samples.length).toBeGreaterThan(35);
    for(let i=1;i<samples.length;i++)expect(samples[i].y,`frame ${i}`).toBeGreaterThan(samples[i-1].y);
  } finally {await page.evaluate(()=>(window as any).restoreMotion());}
});

test('a temporarily older iframe timestamp does not erase an earned score',async({page})=>{
  await page.evaluate(()=>(window as any).testVideo.playVideo());
  await page.clock.runFor(7650);await page.keyboard.press('l');
  await expect(page.locator('#score')).toHaveText('1,960');
  await page.evaluate(()=>{
    const video=(window as any).testVideo,original=video.getCurrentTime.bind(video),start=performance.now();
    video.getCurrentTime=()=>original()-(performance.now()-start<100?.12:0);
  });
  await page.clock.runFor(200);
  await expect(page.locator('#score')).toHaveText('1,960');
  await expect(page.locator('#game-notice')).not.toContainText('後方シーク');
});
