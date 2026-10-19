import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {api} from '../browser/mock-video';

test.beforeEach(async({page})=>{
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
});

test('pending audio reports startup failure, recovers without restarting the video and logs dropped old taps',async({page})=>{
  await page.addInitScript(()=>{
    const state=(window as any).startupAudio={blocked:true,pending:[] as (()=>void)[],starts:0,contexts:[] as AudioContext[]};
    const Native=window.AudioContext;
    window.AudioContext=class extends Native {
      constructor(...args:ConstructorParameters<typeof AudioContext>){super(...args);state.contexts.push(this);}
      get state():AudioContextState{return state.blocked?'suspended':super.state;}
      resume(){return state.blocked?new Promise<void>((resolve,reject)=>state.pending.push(()=>super.resume().then(resolve,reject))):super.resume();}
      createBufferSource(){const source=super.createBufferSource(),start=source.start.bind(source);source.start=(...args:Parameters<typeof start>)=>{state.starts++;start(...args);};return source;}
    };
  });
  await page.goto('/game.html?song=biscuit-case&sync=1');await expect(page.locator('#play-start')).toBeEnabled();
  await page.locator('.sync-diagnostics summary').click();await page.locator('#play-start').click();
  for(const key of ['s','d','f'])await page.keyboard.press(key);
  await expect(page.locator('#game-notice')).toContainText('ノーツ音を有効にできません');
  expect(await page.evaluate(()=>(window as any).startupAudio.starts)).toBe(0);
  const before=await page.evaluate(()=>(window as any).testVideo.getCurrentTime());
  await page.evaluate(()=>{const state=(window as any).startupAudio;state.blocked=false;state.pending.forEach((release:()=>void)=>release());});
  await expect(page.locator('#game-notice')).toContainText('ノーツ音の準備ができました');
  expect(await page.evaluate(()=>(window as any).testVideo.getCurrentTime())).toBeGreaterThanOrEqual(before);
  expect(await page.evaluate(()=>(window as any).startupAudio.starts)).toBe(0);
  await page.keyboard.press('l');await expect.poll(()=>page.evaluate(()=>(window as any).startupAudio.starts)).toBe(1);
  await page.locator('.sync-diagnostics summary').click();
  await expect.poll(()=>page.locator('.sync-diagnostics dd').last().textContent()).toContain('1再生');
  const downloaded=page.waitForEvent('download');
  await page.locator('.sync-diagnostics [data-action="download"]').evaluate((button:HTMLButtonElement)=>button.click());
  const file=await downloaded,data=JSON.parse(await readFile((await file.path())!,'utf8'));
  expect(data.startupSamples.some((row:any)=>row.audio?.state==='suspended'&&row.audio.requested===3&&row.audio.started===0)).toBe(true);
  const audio=data.samples.at(-1).audio;expect(audio.state).toBe('running');expect(audio.requested).toBe(4);expect(audio.started).toBe(1);expect(audio.lateDrops).toBe(3);
});

test('trusted touch release retries audio activation even when pointerdown could not unlock',async({page},info)=>{
  test.skip(info.project.name!=='mobile-touch','Requires a trusted touchend');
  await page.addInitScript(()=>{
    const state=(window as any).releaseAudio={released:false,starts:0,contexts:[] as AudioContext[]};
    document.addEventListener('touchend',event=>{if(event.isTrusted)state.released=true;},{capture:true});
    const Native=window.AudioContext;
    window.AudioContext=class extends Native {
      constructor(...args:ConstructorParameters<typeof AudioContext>){super(...args);state.contexts.push(this);}
      get state():AudioContextState{return state.released?super.state:'suspended';}
      resume(){return state.released?super.resume():Promise.resolve();}
      createBufferSource(){const source=super.createBufferSource(),start=source.start.bind(source);source.start=(...args:Parameters<typeof start>)=>{state.starts++;start(...args);};return source;}
    };
  });
  await page.goto('/game.html?song=biscuit-case');await expect(page.locator('#play-start')).toBeEnabled();
  await page.locator('#play-start').click();
  expect(await page.evaluate(()=>(window as any).releaseAudio.starts)).toBe(0);
  await page.locator('.lane-button').nth(5).tap();
  await expect.poll(()=>page.evaluate(()=>(window as any).releaseAudio.contexts[0].state)).toBe('running');
  const before=await page.evaluate(()=>(window as any).releaseAudio.starts);
  await page.locator('.lane-button').nth(4).tap();
  await expect.poll(()=>page.evaluate(()=>(window as any).releaseAudio.starts)).toBe(before+1);
});
