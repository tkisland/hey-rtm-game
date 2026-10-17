import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { api } from './mock-video';

// Drive only the audio clock. Native nodes are still scheduled; physical latency is not measured.
async function setup(page: Page) {
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    (window as any).previewTime = 0;
    (window as any).previewStarts = [];
    (window as any).previewContexts = [];
    (window as any).previewCymbals = [];
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) { super(options); (window as any).previewContexts.push(this); }
      get currentTime() { return (window as any).previewTime; }
      resume() {
        if (!(window as any).holdPreviewResume) return super.resume();
        return new Promise<void>((resolve, reject) => {
          (window as any).releasePreviewResume = () => super.resume().then(resolve, reject);
        });
      }
    };
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function(when) { (window as any).previewReferenceContext = this.context; (window as any).previewStarts.push(when); start.call(this, when); };
    const sourceStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) {
      (window as any).previewCymbals.push({when:args[0],now:this.context.currentTime,sameClock:this.context===(window as any).previewReferenceContext,duration:this.buffer?.duration,peak:Math.max(...(this.buffer?.getChannelData(0)??[]).map(Math.abs))});
      sourceStart.apply(this,args);
    };
  });
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ body: api }));
  await page.goto('/game.html?chart=test');
  await expect(page.locator('#restart')).toBeEnabled();
}
async function open(page: Page) {
  await page.locator('#settings-toggle').click();
  await page.locator('#flow-calibrate').click();
  await expect(page.locator('.timing-preview')).toBeVisible();
}
async function advance(page: Page, time: number) {
  const before = await page.evaluate(() => (window as any).previewTime as number);
  // Keep normal update intervals; a suspended clock must still trigger the interruption guard.
  for (let now = before + .9; now < time; now += .9) {
    await page.evaluate(async now => { (window as any).previewTime = now; await new Promise(requestAnimationFrame); }, now);
  }
  await page.evaluate(async time => { (window as any).previewTime = time; await new Promise(requestAnimationFrame); }, time);
}
async function begin(page: Page) {
  const count = await page.evaluate(() => (window as any).previewStarts.length);
  await page.locator('#timing-preview-start').click();
  await expect.poll(() => page.evaluate(() => (window as any).previewStarts.length)).toBe(count + 28);
  return page.evaluate(() => (window as any).previewStarts.slice(-28) as number[]);
}
async function range(page: Page, value: number) {
  await page.locator('#timing-preview-offset').fill(String(value));
  await page.locator('#timing-preview-offset').dispatchEvent('input');
}
async function tap(page: Page, lane: number, touch: boolean) {
  if (touch) await page.locator('.timing-pad').nth(lane).tap();
  else { await page.locator('.timing-pad').nth(lane).focus(); await page.keyboard.press(['s','d','f','j','k','l'][lane]); }
}

test('rehearses real moving notes, previews correction immediately and saves only on apply', async ({ page }, info) => {
  await setup(page);
  await page.evaluate(() => localStorage.setItem('hey-rhythm-settings-v1', JSON.stringify({ inputOffset: 140, soundDelay: 150, sound: false, soundVolume: 0, travel: 3 })));
  await page.reload(); await expect(page.locator('#restart')).toBeEnabled();
  // Start with an earned score, to prove the rehearsal never resets or adds to it.
  await page.evaluate(() => {
    const video = (window as any).testVideo;
    video.liveClock = false; video.seekTo(12.14); video.playVideo();
    document.getElementById('game-canvas')!.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyS',key:'s',bubbles:true}));
    document.getElementById('game-canvas')!.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyS',key:'s',bubbles:true}));
  });
  await expect(page.locator('#score')).toHaveText('1,000');
  await open(page);
  expect(await page.evaluate(() => (window as any).testVideo.state)).toBe(2);
  await expect(page.locator('#timing-preview-value')).toHaveText('+140 ms');
  // Capture head rectangles on this canvas to verify actual flow and corrected receptor alignment.
  await page.evaluate(() => {
    (window as any).previewHeads = [];
    const round = CanvasRenderingContext2D.prototype.roundRect;
    CanvasRenderingContext2D.prototype.roundRect = function(...args) {
      if (this.canvas === document.querySelector('.timing-field canvas')) (window as any).previewHeads.push({x:args[0],y:args[1],w:args[2],h:args[3]});
      return round.apply(this,args);
    };
  });
  const times = await begin(page);
  for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(.9);
  await advance(page, times[4] - 1);
  const headY = await page.evaluate(() => (window as any).previewHeads.at(-1).y);
  await advance(page, times[4] + .18);
  expect(await page.evaluate(() => (window as any).previewHeads.at(-1).y)).toBeGreaterThan(headY);
  await tap(page, 2, info.project.name === 'mobile-touch');
  await expect(page.locator('#timing-preview-feedback')).toHaveText('PERFECT · 遅い +40 ms');
  await expect(page.locator('#input-offset')).toHaveValue('140');
  await expect(page.locator('#score')).toHaveText('1,000');
  await range(page, 240);
  await advance(page, times[5] + .24);
  const geometry = await page.evaluate(async () => {
    const { fieldGeometry } = await import('/src/field-geometry.ts');
    const rect = document.querySelector('.timing-field canvas')!.getBoundingClientRect();
    const heads = (window as any).previewHeads;
    const head = heads.filter((head: any) => Math.abs(head.y + head.h / 2 - fieldGeometry(rect.width, rect.height).near) < 1).at(-1);
    return { center: head.y + head.h / 2, near: fieldGeometry(rect.width, rect.height).near };
  });
  expect(geometry.center).toBeCloseTo(geometry.near, 2);
  if (info.project.name === 'mobile-touch') await tap(page, 3, true);
  else await page.keyboard.press('j'); // The range still has focus after adjustment.
  await expect(page.locator('#timing-preview-feedback')).toHaveText('PERFECT · ずれ 0 ms');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!).inputOffset)).toBe(140);
  await page.locator('#timing-preview-apply').click();
  await expect(page.locator('.timing-preview')).not.toBeVisible();
  await expect(page.locator('#input-offset')).toHaveValue('240');
  await expect(page.locator('#sound-delay')).toHaveValue('150');
  await expect(page.locator('#score')).toHaveText('1,000');
  expect(await page.evaluate(() => (window as any).testVideo.state)).toBe(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!))).toMatchObject({ inputOffset:240, soundDelay:150, sound:false, soundVolume:0, travel:2.5 });
  await expect.poll(() => page.evaluate(() => (window as any).previewContexts.at(-1).state)).toBe('closed');
  await page.goto('/editor.html'); await page.locator('.timing-settings summary').click();
  await expect(page.locator('#editor-input-offset')).toHaveValue('240');
  await page.locator('#editor-flow-calibrate').click(); await expect(page.locator('#timing-preview-value')).toHaveText('+240 ms');
});

test('automatically aligns moving heads and judgement from original taps without accumulating old correction', async ({page},info) => {
  await setup(page);
  await page.evaluate(() => localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({inputOffset:300,travel:1,sound:false,soundVolume:0,soundDelay:150})));
  await page.reload(); await expect(page.locator('#restart')).toBeEnabled(); await open(page);
  await page.evaluate(() => {
    (window as any).autoHeads=[];
    const clear=CanvasRenderingContext2D.prototype.clearRect, round=CanvasRenderingContext2D.prototype.roundRect;
    CanvasRenderingContext2D.prototype.clearRect=function(...args) { if(this.canvas===document.querySelector('.timing-field canvas')) (window as any).autoHeads=[]; return clear.apply(this,args); };
    CanvasRenderingContext2D.prototype.roundRect=function(...args) { if(this.canvas===document.querySelector('.timing-field canvas')) (window as any).autoHeads.push({y:args[1]+args[3]/2});return round.apply(this,args); };
  });
  const times=await begin(page), lanes=[2,3,1,4,0,5];
  // The saved 1s setting is ignored: a head appears exactly 2.5s before its corrected target.
  await advance(page,times[4]+.3-2.5-.01);
  expect(await page.evaluate(()=>(window as any).autoHeads.length)).toBe(0);
  await advance(page,times[4]+.3-2.5+.01);
  expect(await page.evaluate(()=>(window as any).autoHeads.length)).toBeGreaterThan(0);
  for(let i=0;i<8;i++) {
    await advance(page,times[i+4]-.1); await tap(page,lanes[i%6],info.project.name==='mobile-touch');
    if(i<7) await expect(page.locator('#timing-preview-value')).toHaveText('+300 ms');
  }
  await expect(page.locator('#timing-preview-value')).toHaveText('-100 ms');
  await expect(page.locator('#timing-preview-auto')).toContainText('自動反映：-100 ms');
  await expect(page.locator('#timing-preview-feedback')).toHaveText('PERFECT · ずれ 0 ms');
  await tap(page,lanes[7%6],info.project.name==='mobile-touch'); // Same note is never sampled twice.
  await expect(page.locator('#timing-preview-auto')).toContainText('有効8回');
  await advance(page,times[12]-.1);
  const aligned=await page.evaluate(async()=>{
    const {fieldGeometry}=await import('/src/field-geometry.ts');
    const rect=document.querySelector('.timing-field canvas')!.getBoundingClientRect();
    return (window as any).autoHeads.some((head:any)=>Math.abs(head.y-fieldGeometry(rect.width,rect.height).near)<.01);
  });
  expect(aligned).toBe(true);
  for(let i=8;i<20;i++) {
    await advance(page,times[i+4]-.1); await tap(page,lanes[i%6],info.project.name==='mobile-touch');
    await expect(page.locator('#timing-preview-value')).toHaveText('-100 ms');
    await expect(page.locator('#timing-preview-feedback')).toHaveText('PERFECT · ずれ 0 ms');
  }
  await expect(page.locator('#input-offset')).toHaveValue('300');
  await page.locator('#timing-preview-apply').click(); await expect(page.locator('#input-offset')).toHaveValue('-100');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!))).toMatchObject({inputOffset:-100,travel:2.5,sound:false,soundVolume:0,soundDelay:150});
  await expect(page.locator('#score')).toHaveText('0');
});

test('retains correction until stable taps are available and ignores an isolated late tap', async ({page},info) => {
  await setup(page); await open(page); const times=await begin(page),lanes=[2,3,1,4,0,5];
  for(let i=0;i<10;i++) {
    await advance(page,times[i+4]+(i===7?.35:.08)); await tap(page,lanes[i%6],info.project.name==='mobile-touch');
    if(i<8) await expect(page.locator('#timing-preview-value')).toHaveText('0 ms');
    if(i===7) await expect(page.locator('#timing-preview-auto')).toContainText('ばらつき');
  }
  await expect(page.locator('#timing-preview-value')).toHaveText('+80 ms');
  await expect(page.locator('#timing-preview-feedback')).toHaveText('PERFECT · ずれ 0 ms');
  await page.locator('#timing-preview-close').click(); await expect(page.locator('#input-offset')).toHaveValue('0');
  await page.locator('#flow-calibrate').click(); await expect(page.locator('#timing-preview-value')).toHaveText('0 ms');
});

test('plays real cymbal samples on the reference clock, supports mute and keeps game audio preferences', async ({page},info) => {
  await setup(page);
  await page.evaluate(()=>localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false,soundVolume:0,soundDelay:150})));
  await page.reload(); await expect(page.locator('#restart')).toBeEnabled(); await open(page);
  const times=await begin(page);
  await advance(page,times[4]+.08); await tap(page,2,info.project.name==='mobile-touch');
  const sounds=await page.evaluate(()=>(window as any).previewCymbals);
  expect(sounds).toHaveLength(1); expect(sounds[0].sameClock).toBe(true);
  expect(sounds[0].when).toBe(sounds[0].now); expect(sounds[0].peak).toBeGreaterThan(.3); expect(sounds[0].duration).toBeGreaterThan(.05);
  await page.locator('.timing-preview-help summary').click(); await page.locator('#timing-preview-cymbal').uncheck();
  await advance(page,times[5]+.08); await tap(page,3,info.project.name==='mobile-touch');
  expect(await page.evaluate(()=>(window as any).previewCymbals.length)).toBe(1);
  await page.locator('#timing-preview-cymbal').check(); await page.locator('#timing-preview-volume').fill('30'); await page.locator('#timing-preview-volume').dispatchEvent('input');
  await advance(page,times[6]+.08); await tap(page,1,info.project.name==='mobile-touch');
  expect(await page.evaluate(()=>(window as any).previewCymbals.length)).toBe(2);
  await page.locator('#timing-preview-close').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).previewReferenceContext.state)).toBe('closed');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!))).toMatchObject({sound:false,soundVolume:0,soundDelay:150});
});

test('shows errors outside GOOD, accepts negative correction and discards cancellation', async ({ page }, info) => {
  await setup(page); await open(page);
  const times = await begin(page);
  await advance(page, times[4] + .3);
  await tap(page, 2, info.project.name === 'mobile-touch');
  await expect(page.locator('#timing-preview-feedback')).toHaveText('MISS · 遅い +300 ms');
  await range(page, -100); await advance(page, times[5] - .1);
  await tap(page, 3, info.project.name === 'mobile-touch');
  await expect(page.locator('#timing-preview-feedback')).toHaveText('PERFECT · ずれ 0 ms');
  await page.locator('#timing-preview-minus').click(); await expect(page.locator('#timing-preview-value')).toHaveText('-105 ms');
  await page.locator('#timing-preview-plus').click(); await expect(page.locator('#timing-preview-value')).toHaveText('-100 ms');
  await range(page, 300); await expect(page.locator('#timing-preview-plus')).toBeDisabled();
  await page.locator('#timing-preview-close').click();
  await expect(page.locator('#input-offset')).toHaveValue('0');
  await expect(page.locator('#flow-calibrate')).toBeFocused();
  await page.locator('#flow-calibrate').click(); await expect(page.locator('#timing-preview-value')).toHaveText('0 ms');
  await range(page, -300); await expect(page.locator('#timing-preview-minus')).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(page.locator('#input-offset')).toHaveValue('0');
});

test('stops on interruption and handles end, retry, failed audio and closing during resume', async ({ page }) => {
  await setup(page); await open(page); await begin(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#timing-preview-feedback')).toContainText('中断');
  await expect.poll(() => page.evaluate(() => (window as any).previewContexts.at(-1).state)).toBe('closed');
  const times = await begin(page);
  await advance(page, times.at(-1)! + .81);
  await expect(page.locator('#timing-preview-start')).toHaveText('もう一度');
  await expect(page.locator('#timing-preview-feedback')).toContainText('練習終了');
  await expect.poll(() => page.evaluate(() => (window as any).previewContexts.at(-1).state)).toBe('closed');
  await page.evaluate(() => (window as any).holdPreviewResume = true);
  const starts = await page.evaluate(() => (window as any).previewStarts.length);
  await page.locator('#timing-preview-start').click();
  await expect(page.locator('#timing-preview-start')).toBeDisabled();
  await page.locator('#timing-preview-close').click();
  await page.evaluate(async () => { try { await (window as any).releasePreviewResume(); } catch { /* closed before resume */ } });
  expect(await page.evaluate(() => (window as any).previewStarts.length)).toBe(starts);
  await expect(page.locator('#input-offset')).toHaveValue('0');
  await page.locator('#flow-calibrate').click();
  await page.evaluate(() => { (window as any).holdPreviewResume = false; AudioContext.prototype.resume = () => Promise.reject(new Error('Unavailable')); });
  await page.locator('#timing-preview-start').click();
  await expect(page.locator('#timing-preview-feedback')).toContainText('再生できません');
  await expect(page.locator('#timing-preview-start')).toBeEnabled();
});

test('keeps notes, pads and adjustment controls reachable on narrow and landscape screens', async ({ page }) => {
  await setup(page); await open(page);
  for (const [width,height] of [[320,480],[390,844],[844,390],[1280,900]]) {
    await page.setViewportSize({width,height});
    await expect(page.locator('.timing-pad')).toHaveCount(6);
    await expect.poll(() => page.locator('.timing-pad').first().evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(44);
    expect(await page.locator('.timing-preview').evaluate(el => el.scrollWidth<=el.clientWidth)).toBe(true);
    for(const id of ['timing-preview-start','timing-preview-apply','timing-preview-close']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      const box=(await page.locator(`#${id}`).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y+box.height).toBeLessThanOrEqual(height);
    }
    await page.locator('.timing-pad').first().scrollIntoViewIfNeeded();
    const pad=(await page.locator('.timing-pad').first().boundingBox())!;
    expect(pad.y).toBeGreaterThanOrEqual(0); expect(pad.y+pad.height).toBeLessThanOrEqual(height);
  }
});
