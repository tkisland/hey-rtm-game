import { test, expect } from '@playwright/test';
import { api } from '../browser/mock-video';

test('offers song alignment, input calibration and note volume, migrates old mute and removes hidden timing shifts', async ({page}) => {
  await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
  await page.addInitScript(()=>{
    if(!localStorage.getItem('hey-rhythm-settings-v1')) localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({inputOffset:80,offset:300,soundDelay:300,sound:false,soundVolume:85}));
    (window as any).cymbalStarts=[];
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){(window as any).cymbalStarts.push({when:args[0],now:this.context.currentTime});return start.apply(this,args);};
  });
  await page.goto('/game.html'); await expect(page.locator('#restart')).toBeEnabled();
  await page.locator('#settings-toggle').click(); const panel=page.locator('#settings-panel');
  await expect(panel.locator('button:not(#settings-close)')).toHaveCount(2);
  await expect(panel.locator('input')).toHaveCount(1); await expect(panel.locator('select')).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'② タップ判定を調整',exact:true})).toBeVisible();
  await expect(panel.getByLabel('ノーツ音の音量')).toHaveValue('0');
  await expect(panel.locator('#offset,#input-offset,#sound-delay,#sound-toggle,#auto-calibrate,#timing-reset,#sound-test')).toHaveCount(0);
  await page.locator('#sound-volume').fill('50'); await page.locator('#sound-volume').dispatchEvent('input');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!))).toMatchObject({sound:true,soundVolume:50,soundDelay:0,offset:0,noteOffset:80,inputOffset:0});
  await page.locator('#settings-close').click(); await page.locator('#play-start').click();
  await page.evaluate(()=>{
    const video=(window as any).testVideo; video.liveClock=false; video.seekTo(7.73); video.playVideo();
    const canvas=document.getElementById('game-canvas')!;
    canvas.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyL',key:'l',bubbles:true}));
    canvas.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyL',key:'l',bubbles:true}));
  });
  await expect(page.locator('#judgement-5 .judgement-label')).toHaveText('PERFECT');
  await expect.poll(()=>page.evaluate(()=>(window as any).cymbalStarts.length)).toBe(1);
  const sound=await page.evaluate(()=>(window as any).cymbalStarts[0]); expect(Math.abs(sound.when-sound.now)).toBeLessThan(.03);
  await page.locator('#settings-toggle').click(); await page.locator('#sound-volume').fill('0'); await page.locator('#sound-volume').dispatchEvent('input');
  await page.locator('#settings-close').click(); await page.keyboard.press('s');
  expect(await page.evaluate(()=>(window as any).cymbalStarts.length)).toBe(1);
  await page.reload(); await expect(page.locator('#restart')).toBeEnabled(); await page.locator('#settings-toggle').click();
  await expect(page.locator('#sound-volume')).toHaveValue('0');
  await page.locator('#flow-calibrate').click(); await expect(page.locator('#timing-preview-value')).toHaveText('0 ms');
});
