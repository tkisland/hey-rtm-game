import { test, expect } from '@playwright/test';
import { api } from '../browser/mock-video';

test.beforeEach(async ({page}) => {
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
});

test('menu volume is shared with the tutorial and game, including mute and reload', async ({page}) => {
  await page.goto('/');await page.locator('#settings-toggle').click();
  const settings=page.locator('#settings-panel');await expect(settings).toBeVisible();
  await expect(settings.locator('input')).toHaveCount(2);
  await expect(settings.locator('button:not(#settings-close)')).toHaveCount(2);
  await settings.getByLabel('ノーツ音の音量').fill('35');
  await expect(page.locator('#sound-volume-value')).toHaveText('35%');
  await page.locator('#settings-close').click();await expect(page.locator('#settings-toggle')).toBeFocused();
  await page.locator('#open-tutorial').click();await expect(page.locator('#tutorial-volume')).toHaveValue('35');
  await page.locator('#tutorial-close').click();await page.locator('#settings-toggle').click();
  await settings.getByLabel('ノーツ音の音量').fill('0');
  await page.keyboard.press('Escape');await expect(settings).not.toBeVisible();
  await expect(page.locator('#settings-toggle')).toHaveAttribute('aria-expanded','false');
  await page.reload();await page.locator('#settings-toggle').click();await expect(page.locator('#sound-volume')).toHaveValue('0');
  await page.locator('#settings-close').click();await page.locator('#open-tutorial').click();
  await expect(page.locator('#tutorial-sound')).not.toBeChecked();await page.locator('#tutorial-close').click();
  await page.locator('.song-play').first().click();await expect(page.locator('#restart')).toBeEnabled();
  await page.locator('#settings-toggle').click();await expect(page.locator('#sound-volume')).toHaveValue('0');
});

test('menu rehearsal plays sound, saves only applied correction and needs no YouTube player', async ({page}) => {
  const videos:string[]=[];page.on('request',request=>{if(request.url().includes('youtube.com'))videos.push(request.url());});
  await page.addInitScript(()=>{
    (window as any).referenceStarts=[];
    const start=OscillatorNode.prototype.start;
    OscillatorNode.prototype.start=function(when){(window as any).referenceStarts.push(when);start.call(this,when);};
  });
  await page.goto('/');await page.locator('#settings-toggle').click();await page.locator('#flow-calibrate').click();
  await page.locator('#timing-preview-start').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).referenceStarts.length)).toBe(14);
  await expect(page.locator('.timing-pad')).toHaveCount(6);
  await page.locator('#timing-preview-offset').fill('80');await page.locator('#timing-preview-apply').click();
  await expect(page.locator('#settings-panel')).toBeVisible();
  await page.locator('#flow-calibrate').click();await expect(page.locator('#timing-preview-value')).toHaveText('+80 ms');
  await page.locator('#timing-preview-plus').click();await page.keyboard.press('Escape');
  await expect(page.locator('.timing-preview')).not.toBeVisible();await expect(page.locator('#flow-calibrate')).toBeFocused();
  await page.locator('#settings-close').click();await page.reload();
  await page.locator('#settings-toggle').click();await page.locator('#flow-calibrate').click();
  await expect(page.locator('#timing-preview-value')).toHaveText('+80 ms');expect(videos).toEqual([]);
  await page.locator('#timing-preview-close').click();await page.locator('#settings-close').click();
  await page.locator('.song-play').first().click();await expect(page.locator('#restart')).toBeEnabled();
  await page.locator('#settings-toggle').click();await page.locator('#flow-calibrate').click();
  await expect(page.locator('#timing-preview-value')).toHaveText('+80 ms');
});

test('menu reports failed storage without trapping settings or calibration', async ({page}) => {
  await page.addInitScript(()=>{Storage.prototype.setItem=()=>{throw new Error('blocked');};});
  await page.goto('/');await page.locator('#settings-toggle').click();await page.locator('#sound-volume').fill('50');
  await expect(page.locator('#storage-status')).toContainText('ブラウザへの保存ができません');
  await page.locator('#flow-calibrate').click();await page.locator('#timing-preview-plus').click();
  await page.locator('#timing-preview-apply').click();await expect(page.locator('#storage-status')).toContainText('ブラウザへの保存ができません');
  await page.locator('#settings-close').click();await expect(page.locator('#settings-toggle')).toBeFocused();
});

test('travel time persists between menu and game without changing calibration or note arrival', async ({page}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('hey-rhythm-settings-v1')) localStorage.setItem('hey-rhythm-settings-v1', JSON.stringify({noteOffset:100,inputOffset:0,soundVolume:35}));
  });
  await page.goto('/');await page.locator('#settings-toggle').click();
  await expect(page.locator('#travel')).toHaveValue('2.5');
  await page.locator('#travel').fill('4');await expect(page.locator('#travel-value')).toHaveText('4秒');
  await page.locator('#settings-close').click();await page.locator('.song-play').first().click();
  await expect(page.locator('#restart')).toBeEnabled();await page.locator('#settings-toggle').click();
  await expect(page.locator('#travel')).toHaveValue('4');await page.locator('#travel').fill('1.25');
  await expect(page.locator('#travel-value')).toHaveText('1.25秒');
  await page.reload();await expect(page.locator('#restart')).toBeEnabled();
  await page.locator('#settings-toggle').click();await expect(page.locator('#travel')).toHaveValue('1.25');
  expect(await page.evaluate(() => {
    const {travel,noteOffset,inputOffset,soundVolume} = JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!);
    return {travel,noteOffset,inputOffset,soundVolume};
  })).toEqual({travel:1.25,noteOffset:100,inputOffset:0,soundVolume:35});
  await page.locator('#settings-close').click();
  await page.evaluate(() => { const video = (window as any).testVideo; video.seekTo(7.75); video.liveClock=false; video.playVideo(); });
  await page.keyboard.press('l');await expect(page.locator('#judgement-5 .judgement-label')).toHaveText('PERFECT');
  await expect(page.locator('#score')).toHaveText('1,968');
  await page.goto('/');await page.locator('#settings-toggle').click();await expect(page.locator('#travel')).toHaveValue('1.25');
});
