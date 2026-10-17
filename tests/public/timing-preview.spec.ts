import { test, expect } from '@playwright/test';
import { api } from '../browser/mock-video';

test('public settings rehearse with sound and save only an applied input correction', async ({page}) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({body:api}));
  await page.addInitScript(() => {
    (window as any).referenceStarts = [];
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function(when) { (window as any).referenceStarts.push(when); start.call(this, when); };
  });
  await page.goto('/game.html'); await expect(page.locator('#restart')).toBeEnabled();
  await page.evaluate(() => (window as any).testVideo.playVideo());
  await page.locator('#settings-toggle').click(); await page.locator('#flow-calibrate').click();
  await expect(page.locator('.timing-preview')).toBeVisible();
  expect(await page.evaluate(() => (window as any).testVideo.state)).toBe(2);
  await page.locator('#timing-preview-start').click();
  await expect.poll(() => page.evaluate(() => (window as any).referenceStarts.length)).toBe(28);
  await expect(page.locator('.timing-pad')).toHaveCount(6);
  await page.locator('#timing-preview-offset').fill('100'); await page.locator('#timing-preview-offset').dispatchEvent('input');
  await expect(page.locator('#input-offset')).toHaveValue('0');
  await page.locator('#timing-preview-apply').click(); await expect(page.locator('#input-offset')).toHaveValue('100');
  await expect(page.locator('#score')).toHaveText('0');
  await page.reload(); await expect(page.locator('#restart')).toBeEnabled(); await page.locator('#settings-toggle').click();
  await expect(page.locator('#input-offset')).toHaveValue('100');
  await page.locator('#flow-calibrate').click(); await page.locator('#timing-preview-plus').click();
  await expect(page.locator('#timing-preview-value')).toHaveText('+105 ms');
  await page.locator('#timing-preview-close').click(); await expect(page.locator('#input-offset')).toHaveValue('100');
  await expect(page.locator('#chart-source')).toHaveCount(0);
});
