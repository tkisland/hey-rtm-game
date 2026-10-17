import { test, expect } from '@playwright/test';
import { api } from '../browser/mock-video';
import type { Page } from '@playwright/test';
import smg from '../../src/charts/smg004.json' with {type:'json'};

test.beforeEach(async ({page})=>{
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
  await page.addInitScript(()=>{
    (window as any).noteStarts=[];
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){(window as any).noteStarts.push(args[0]);return start.apply(this,args);};
  });
});
async function open(page:Page){
  await page.goto('/game.html');await expect(page.locator('#restart')).toBeEnabled();
  await page.evaluate(()=>{(window as any).mainVideo=(window as any).testVideo;(window as any).mainVideo.playVideo();});
  await page.locator('#settings-toggle').click();await page.locator('#flow-calibrate').click();
  await page.locator('#timing-preview-song').click();await expect(page.locator('#song-timing-start')).toBeEnabled();
}
const preferences=(page:Page)=>page.evaluate(()=>JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')??'{}'));

test('compares actual MV and chart sounds, applies independent visual correction and preserves score',async({page})=>{
  await open(page);expect(await page.evaluate(()=>(window as any).mainVideo.state)).toBe(2);
  await expect(page.locator('.timing-preview')).not.toBeVisible();
  await page.locator('#song-timing-offset').fill('100');await page.locator('#song-timing-visual').fill('-50');
  expect((await preferences(page)).inputOffset??0).toBe(0);
  await page.locator('#song-timing-start').click();
  await page.evaluate(time=>{const v=(window as any).testVideo;v.liveClock=false;v.seekTo(time);},smg.notes[0].time+.1-.04);
  await page.waitForTimeout(80);
  const before=await page.evaluate(()=>(window as any).noteStarts.length);
  // Moving the visual control must not reset/starve the independent sound timeline.
  await page.locator('#song-timing-visual').fill('120');
  await page.evaluate(time=>(window as any).testVideo.seekTo(time),smg.notes[0].time+.1+.01);
  await expect.poll(()=>page.evaluate(()=>(window as any).noteStarts.length)).toBeGreaterThan(before);
  await page.locator('#song-timing-start').click();
  const paused=await page.evaluate(()=>(window as any).noteStarts.length);await page.waitForTimeout(150);
  expect(await page.evaluate(()=>(window as any).noteStarts.length)).toBe(paused);
  await page.locator('#song-timing-visual').fill('-50');
  await page.locator('#song-timing-apply').click();await expect(page.locator('.song-timing-preview')).not.toBeVisible();
  expect(await preferences(page)).toMatchObject({inputOffset:100,visualOffset:-50});await expect(page.locator('#score')).toHaveText('0');
  // The original game player remains intact; visual-only correction never shifts its judgement.
  await page.locator('#settings-close').click();
  await page.evaluate(()=>{const v=(window as any).mainVideo;v.liveClock=false;v.seekTo(7.75);v.playVideo();
    const canvas=document.getElementById('game-canvas')!;canvas.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyL',bubbles:true}));canvas.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyL',bubbles:true}));});
  await expect(page.locator('#judgement-5 .judgement-label')).toHaveText('PERFECT');
  await page.reload();await page.locator('#settings-toggle').click();await page.locator('#flow-calibrate').click();await page.locator('#timing-preview-song').click();
  await expect(page.locator('#song-timing-offset')).toHaveValue('100');await expect(page.locator('#song-timing-visual')).toHaveValue('-50');
});

test('cancel discards both trial values and reopening starts with saved preferences',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({inputOffset:80,visualOffset:20,soundVolume:35})));
  await open(page);await expect(page.locator('#song-timing-volume')).toHaveValue('35');
  await page.locator('#song-timing-offset').fill('-100');await page.locator('#song-timing-visual').fill('200');
  await page.locator('#song-timing-start').click();await page.keyboard.press('Escape');
  await expect(page.locator('.song-timing-preview')).not.toBeVisible();
  expect(await preferences(page)).toMatchObject({inputOffset:80,visualOffset:20,soundVolume:35});
  await page.locator('#flow-calibrate').click();await page.locator('#timing-preview-song').click();
  await expect(page.locator('#song-timing-offset')).toHaveValue('80');await expect(page.locator('#song-timing-visual')).toHaveValue('20');
  await expect(page.locator('#song-timing-start')).toBeEnabled();
});

test('top-page settings lead to the actual song adjustment without autoplay',async({page})=>{
  await page.goto('/');await page.locator('#settings-toggle').click();await page.locator('#flow-calibrate').click();
  await page.locator('#timing-preview-song').click();await expect(page.locator('.song-timing-preview')).toBeVisible();
  await expect(page.locator('#song-timing-start')).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).testVideo.state)).not.toBe(1);
  await page.locator('#song-timing-offset').fill('-25');await page.locator('#song-timing-visual').fill('75');
  await page.locator('#song-timing-apply').click();expect(await preferences(page)).toMatchObject({inputOffset:-25,visualOffset:75});
});
