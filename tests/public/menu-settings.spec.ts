import { test, expect } from '@playwright/test';
import { api } from '../browser/mock-video';

test.beforeEach(async ({page}) => {
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
});

test('menu volume is shared with the tutorial and game, including mute and reload', async ({page}) => {
  await page.goto('/');await page.locator('#settings-toggle').click();
  const settings=page.locator('#settings-panel');await expect(settings).toBeVisible();
  await expect(settings.locator('input')).toHaveCount(1);
  await expect(settings.locator('button:not(#settings-close)')).toHaveCount(1);
  await settings.getByLabel('シンバル音の音量').fill('35');
  await expect(page.locator('#sound-volume-value')).toHaveText('35%');
  await page.locator('#settings-close').click();await expect(page.locator('#settings-toggle')).toBeFocused();
  await page.locator('#open-tutorial').click();await expect(page.locator('#tutorial-volume')).toHaveValue('35');
  await page.locator('#tutorial-close').click();await page.locator('#settings-toggle').click();
  await settings.getByLabel('シンバル音の音量').fill('0');
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
  await expect.poll(()=>page.evaluate(()=>(window as any).referenceStarts.length)).toBe(28);
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
