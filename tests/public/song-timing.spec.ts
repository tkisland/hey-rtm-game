import {test,expect} from '@playwright/test';
import {api} from '../browser/mock-video';

test.beforeEach(async({page})=>{
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
});
test('migrates existing alignment, previews MV without scoring, and saves each correction independently',async({page})=>{
  await page.addInitScript(()=>{if(!localStorage.getItem('hey-rhythm-settings-v1'))localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({inputOffset:100}));});
  await page.goto('/game.html');await expect(page.locator('#restart')).toBeEnabled();
  await page.evaluate(()=>{const v=(window as any).testVideo;(window as any).mainVideo=v;v.liveClock=false;v.seekTo(7.75);v.playVideo();
    const c=document.getElementById('game-canvas')!;c.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyL',bubbles:true}));c.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyL',bubbles:true}));});
  await expect(page.locator('#score')).toHaveText('1,000');
  await page.locator('#settings-toggle').click();await page.locator('#song-calibrate').click();
  await expect(page.locator('#song-timing-start')).toBeEnabled();
  await expect(page.locator('#song-timing-offset')).toHaveValue('100');
  await page.locator('#song-timing-start').click();
  await page.locator('#song-timing-offset').fill('150');
  await expect(page.locator('#song-timing-offset-value')).toHaveText('+150 ms');
  await page.locator('#song-timing-apply').click();
  await expect(page.locator('#score')).toHaveText('1,000');
  await page.locator('#flow-calibrate').click();await expect(page.locator('#timing-preview-value')).toHaveText('0 ms');
  await page.locator('#timing-preview-offset').fill('80');await page.locator('#timing-preview-apply').click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!))).toMatchObject({noteOffset:150,inputOffset:80});
  await page.locator('#song-calibrate').click();await expect(page.locator('#song-timing-offset')).toHaveValue('150');
  await page.locator('#song-timing-offset').fill('-100');await page.locator('#song-timing-close').click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!))).toMatchObject({noteOffset:150,inputOffset:80});
  await page.locator('#settings-close').click();
  // Both corrections affect judgement, while the renderer uses only noteOffset.
  await page.evaluate(()=>{const v=(window as any).mainVideo;v.liveClock=false;v.seekTo(8.241445);v.playVideo();
    const c=document.getElementById('game-canvas')!;c.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyK',bubbles:true}));c.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyK',bubbles:true}));});
  await expect(page.locator('#judgement-4 .judgement-label')).toHaveText('PERFECT');
  await page.reload();await page.locator('#settings-toggle').click();await page.locator('#song-calibrate').click();
  await expect(page.locator('#song-timing-offset')).toHaveValue('150');
});
test('menu opens song preview without autoplay and keeps controls reachable',async({page})=>{
  await page.goto('/');await page.locator('#settings-toggle').click();await page.locator('#song-calibrate').click();
  await expect(page.locator('.song-timing-preview')).toBeVisible();await expect(page.locator('#song-timing-start')).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).testVideo.state)).not.toBe(1);
  await page.locator('#song-timing-offset').fill('100');await page.locator('#song-timing-apply').click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!))).toMatchObject({noteOffset:100,inputOffset:0});
});

test('input adjustment never moves actual game note geometry',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({noteOffset:100,inputOffset:0}));
    (window as any).gameHeads=[];
    const clear=CanvasRenderingContext2D.prototype.clearRect,round=CanvasRenderingContext2D.prototype.roundRect;
    CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.id==='game-canvas')(window as any).gameHeads=[];return clear.apply(this,args);};
    CanvasRenderingContext2D.prototype.roundRect=function(...args){if(this.canvas.id==='game-canvas')(window as any).gameHeads.push(args.slice(0,4));return round.apply(this,args);};
  });
  await page.goto('/game.html');await expect(page.locator('#restart')).toBeEnabled();
  await page.evaluate(()=>{const v=(window as any).testVideo;v.liveClock=false;v.seekTo(6.65);v.pauseVideo();});
  await expect.poll(()=>page.evaluate(()=>(window as any).gameHeads.length)).toBeGreaterThan(0);
  const before=await page.evaluate(()=>(window as any).gameHeads);
  await page.locator('#settings-toggle').click();await page.locator('#flow-calibrate').click();
  await page.locator('#timing-preview-offset').fill('150');await page.locator('#timing-preview-apply').click();
  await page.locator('#settings-close').click();
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  expect(await page.evaluate(()=>(window as any).gameHeads)).toEqual(before);
});
