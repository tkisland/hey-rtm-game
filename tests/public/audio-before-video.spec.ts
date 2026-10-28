import {test,expect} from '@playwright/test';
import {api} from '../browser/mock-video';

test.beforeEach(async({page})=>{
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
});

for(const diagnostic of [false,true])test(`cold iframe playback waits for note audio, independent of diagnostics (${diagnostic})`,async({page})=>{
  await page.goto(`/game.html?song=biscuit-case${diagnostic?'&sync=1':''}`);
  await expect(page.locator('#play-start')).toBeEnabled();
  // Close without a trusted gesture: showing the panel alone must not unlock audio.
  if(diagnostic)await page.locator('.sync-diagnostics').evaluate((panel:HTMLDetailsElement)=>panel.open=false);
  await page.evaluate(()=>(window as any).testVideo.playVideo());
  await expect.poll(()=>page.evaluate(()=>(window as any).testVideo.getPlayerState())).toBe(2);
  await expect(page.locator('#game-notice')).toContainText('ノーツ音の準備が必要');
  await expect(page.locator('#stage-hint')).toContainText('「ゲームスタート」を押してライブ開始！');
  await page.waitForTimeout(150);
  expect(await page.evaluate(()=>(window as any).testVideo.getCurrentTime())).toBeLessThan(.2);
  await page.evaluate(()=>(window as any).testVideo.playVideo());
  await expect.poll(()=>page.evaluate(()=>(window as any).testVideo.getPlayerState())).toBe(2);
  await page.locator('#play-start').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).testVideo.getPlayerState())).toBe(1);
  await expect(page.locator('#game-notice')).not.toContainText('準備が必要');
});

test('folding diagnostics is an early gesture, so the later iframe play already has prepared audio',async({page})=>{
  await page.addInitScript(()=>{const Native=window.AudioContext;window.AudioContext=class extends Native {constructor(...args:ConstructorParameters<typeof AudioContext>){super(...args);(window as any).preparedContext=this;}};});
  await page.goto('/game.html?sync=1');await expect(page.locator('#play-start')).toBeEnabled();
  await page.locator('.sync-diagnostics summary').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).preparedContext?.state)).toBe('running');
  await page.evaluate(()=>(window as any).testVideo.playVideo());
  await expect.poll(()=>page.evaluate(()=>(window as any).testVideo.getPlayerState())).toBe(1);
  await page.waitForTimeout(100);
  expect(await page.evaluate(()=>(window as any).testVideo.getPlayerState())).toBe(1);
  await expect(page.locator('#game-notice')).not.toContainText('準備が必要');
});

test('muted players can start inside YouTube without preparing an unused audio output',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({soundVolume:0})));
  await page.goto('/game.html');await expect(page.locator('#play-start')).toBeEnabled();
  await page.evaluate(()=>(window as any).testVideo.playVideo());
  await expect.poll(()=>page.evaluate(()=>(window as any).testVideo.getPlayerState())).toBe(1);
  await expect(page.locator('#game-notice')).not.toContainText('準備が必要');
});

test('a slow initial resume finishes before video playback and the first note can score and sound',async({page})=>{
  await page.addInitScript(()=>{
    const result=(window as any).delayedAudio={blocked:true,pending:[] as (()=>void)[],starts:0};
    const Native=window.AudioContext;
    window.AudioContext=class extends Native {
      get state():AudioContextState{return result.blocked?'suspended':super.state;}
      resume(){return result.blocked?new Promise<void>((resolve,reject)=>result.pending.push(()=>super.resume().then(resolve,reject))):super.resume();}
      createBufferSource(){const source=super.createBufferSource(),start=source.start.bind(source);source.start=(...args:Parameters<typeof start>)=>{result.starts++;start(...args);};return source;}
    };
  });
  await page.goto('/game.html?song=biscuit-case');await expect(page.locator('#play-start')).toBeEnabled();
  await page.locator('#play-start').click();
  await page.waitForTimeout(150);
  expect(await page.evaluate(()=>(window as any).testVideo.getCurrentTime())).toBe(0);
  expect(await page.evaluate(()=>(window as any).delayedAudio.starts)).toBe(0);
  await page.evaluate(()=>{const result=(window as any).delayedAudio;result.blocked=false;result.pending.forEach((release:()=>void)=>release());});
  await expect.poll(()=>page.evaluate(()=>(window as any).testVideo.getPlayerState())).toBe(1);
  await page.evaluate(()=>{const video=(window as any).testVideo;video.pauseVideo();video.liveClock=false;video.seekTo(3.85);video.playVideo();});
  await page.keyboard.press('l');
  await expect(page.locator('#score')).toHaveText('1,328');
  expect(await page.evaluate(()=>(window as any).delayedAudio.starts)).toBe(1);
});

test('an error during audio preparation cancels the pending start and keeps the output stopped',async({page})=>{
  await page.addInitScript(()=>{
    const result=(window as any).pendingStart={blocked:true,pending:[] as (()=>void)[],warm:new Set<ConstantSourceNode>()};
    const Native=window.AudioContext;
    window.AudioContext=class extends Native {
      get state():AudioContextState{return result.blocked?'suspended':super.state;}
      resume(){return result.blocked?new Promise<void>((resolve,reject)=>result.pending.push(()=>super.resume().then(resolve,reject))):super.resume();}
      createConstantSource(){
        const source=super.createConstantSource(),start=source.start.bind(source),stop=source.stop.bind(source);
        source.start=(...args:Parameters<typeof start>)=>{result.warm.add(source);start(...args);};
        source.stop=(...args:Parameters<typeof stop>)=>{result.warm.delete(source);stop(...args);};return source;
      }
    };
  });
  await page.goto('/game.html');await expect(page.locator('#play-start')).toBeEnabled();
  await page.locator('#play-start').click();
  await page.evaluate(()=>{const video=(window as any).testVideo;video.options.events.onError({target:video,data:153});});
  await expect(page.locator('#player-error')).toBeVisible();
  await page.evaluate(()=>{const result=(window as any).pendingStart;result.blocked=false;result.pending.forEach((release:()=>void)=>release());});
  await page.waitForTimeout(150);
  expect(await page.evaluate(()=>(window as any).testVideo.getPlayerState())).not.toBe(1);
  expect(await page.evaluate(()=>(window as any).pendingStart.warm.size)).toBe(0);
});
