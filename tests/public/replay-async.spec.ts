import {test,expect} from '@playwright/test';
import {api} from '../browser/mock-video';

test.beforeEach(async({page})=>{
  await page.clock.install({time:new Date('2026-10-22T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-22T00:00:01Z'));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
  await page.addInitScript(()=>localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false})));
  await page.goto('/game.html');await page.clock.runFor(100);await expect(page.locator('#restart')).toBeEnabled();
  await page.evaluate(()=>{const video=(window as any).testVideo;video.liveClock=false;video.seekTo(7.65);video.playVideo();});
  await page.clock.runFor(16);await page.keyboard.press('l');await expect(page.locator('#score')).toHaveText('1,968');
  await page.evaluate(()=>{const video=(window as any).testVideo;video.seekTo(220);video.setState(0);});
  await page.clock.runFor(1700);await expect(page.locator('#result')).toBeVisible();
});

test('replay preserves fresh notes while seek and PLAYING arrive asynchronously after ENDED',async({page})=>{
  await page.evaluate(()=>{
    const video=(window as any).testVideo,seek=video.seekTo.bind(video),play=video.playVideo.bind(video);
    video.seekTo=(time:number)=>setTimeout(()=>seek(time),250);
    video.playVideo=()=>setTimeout(()=>{video.liveClock=true;play();},500);
  });
  for(let replay=0;replay<2;replay++){
    await page.getByRole('button',{name:'もういちど遊ぶ',exact:true}).click();
    await page.clock.runFor(2200);
    await expect(page.locator('#result')).not.toBeVisible();
    await expect(page.locator('#score')).toHaveText('0');
    await expect(page.locator('#control-status')).not.toContainText('FINISH');
    const time=await page.evaluate(()=>(window as any).testVideo.getCurrentTime());
    await page.clock.runFor(Math.round((7.65-time)*1000));
    await page.keyboard.press('l');await expect(page.locator('#score')).toHaveText('1,968');
    await page.evaluate(()=>{const video=(window as any).testVideo;video.time=220;video.anchor=performance.now();video.setState(0);});
    await page.clock.runFor(1700);await expect(page.locator('#result')).toBeVisible();
    await expect(page.locator('#result-accuracy')).toContainText('判定済み 508');
    await expect(page.locator('#result-accuracy')).toContainText('スキップ 0 / 全 508');
  }
});

test('a seek timeout keeps notes unjudged and a retry can start from the first note',async({page})=>{
  await page.evaluate(()=>{
    const video=(window as any).testVideo;
    (window as any).restoreReplay=()=>{delete video.seekTo;delete video.playVideo;};
    video.seekTo=()=>{};video.playVideo=()=>{};
  });
  await page.getByRole('button',{name:'もういちど遊ぶ',exact:true}).click();
  await page.clock.runFor(7000);
  await expect(page.locator('#result')).not.toBeVisible();
  await expect(page.locator('#stage-hint')).toContainText('再試行');
  await page.evaluate(()=>(window as any).restoreReplay());
  await page.locator('#restart').click();await page.clock.runFor(32);
  await page.evaluate(()=>(window as any).testVideo.liveClock=true);
  await page.clock.runFor(7650);await page.keyboard.press('l');
  await expect(page.locator('#score')).toHaveText('1,968');
});
