import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Test-only IFrame API adapter. Production has no fake clock or simulated playback.
const api = `
window.YT = { Player: class {
  constructor(id, options) {
    this.time = 0; this.state = -1; this.liveClock = false; this.anchor = performance.now(); this.options = options;
    const frame = document.createElement('iframe'); frame.src = 'about:blank';
    document.getElementById(id).replaceWith(frame);
    window.testVideo = this;
    setTimeout(() => options.events.onReady({target:this}), 0);
  }
  getCurrentTime() { return this.time + (this.state === 1 && this.liveClock ? (performance.now()-this.anchor)/1000 : 0); }
  getPlayerState() { return this.state; }
  getDuration() { return 220; }
  seekTo(t) { this.time = t; this.anchor = performance.now(); }
  setState(state) { this.time = this.getCurrentTime(); this.anchor = performance.now(); this.state = state; this.options.events.onStateChange({target:this,data:state}); }
  playVideo() { this.setState(1); }
  destroy() {}
}};
window.onYouTubeIframeAPIReady();`;
async function seekPlay(page: Page, time: number) {
  await page.evaluate(time => {
    const video = (window as any).testVideo;
    video.setState(2); video.seekTo(time);
  }, time);
  await page.waitForTimeout(50);
  await page.evaluate(() => (window as any).testVideo.playVideo());
}
test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: api }));
  await page.goto('/');
  await expect(page.locator('#restart')).toBeEnabled();
});

test('keyboard timing, repeat protection, paused/buffering input, seek and restart', async ({ page }) => {
  await page.locator('iframe').evaluate((frame: HTMLIFrameElement) => frame.contentWindow?.focus());
  await page.locator('#game-canvas').click();
  await expect(page.locator('#game-canvas')).toBeFocused();
  await seekPlay(page, 12);
  await page.keyboard.down('s');
  await expect(page.locator('#score')).toHaveText('001000');
  await page.keyboard.down('s');
  await expect(page.locator('#score')).toHaveText('001000');
  await page.keyboard.up('s');
  await expect(page.locator('#combo')).toHaveText('1');
  await page.evaluate(() => (window as any).testVideo.setState(2));
  const score = await page.locator('#score').textContent();
  await page.waitForTimeout(350);
  await page.keyboard.press('d');
  await expect(page.locator('#score')).toHaveText(score!);
  await page.evaluate(() => (window as any).testVideo.setState(3));
  await page.keyboard.press('f');
  await expect(page.locator('#score')).toHaveText(score!);
  await seekPlay(page, 20);
  await expect(page.locator('#game-notice')).toContainText('前方シーク');
  await expect(page.locator('#score')).toHaveText(score!);
  await seekPlay(page, 10);
  await expect(page.locator('#score')).toHaveText('000000');
  await page.locator('#restart').click();
  await expect(page.locator('#combo')).toHaveText('0');
  expect(await page.evaluate(() => (window as any).testVideo.getCurrentTime())).toBeLessThan(10);
});

test('independent simultaneous pointer inputs, settings persistence and high DPI canvas', async ({ page }) => {
  // At beat 4, the deterministic chart has simultaneous notes in lanes 3 and 0.
  await page.locator('.lane-buttons').scrollIntoViewIfNeeded();
  const touches = await Promise.all([0, 3].map(async lane => {
    const box = (await page.locator(`.lane-button[data-lane="${lane}"]`).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, id: lane + 1 };
  }));
  const session = await page.context().newCDPSession(page);
  await seekPlay(page, 12 + 4 * 60 / 140);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
  await expect(page.locator('.lane-button.pressed')).toHaveCount(2);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.lane-button.pressed')).toHaveCount(0);
  await expect(page.locator('#score')).toHaveText('002000');
  await expect(page.locator('#combo')).toHaveText('2');
  await page.locator('#settings-toggle').click();
  await page.locator('#bpm').fill('100');
  await page.locator('#bpm').blur();
  await page.locator('#start-time').fill('8.5');
  await page.locator('#start-time').blur();
  await page.locator('#offset').fill('200');
  await page.locator('#offset').dispatchEvent('input');
  await page.locator('#debug-toggle').check();
  await page.locator('#settings-close').click();
  await page.locator('#restart').click();
  await expect(page.locator('#chart-info')).toContainText('100 BPM · 8.5秒');
  await expect(page.locator('#debug-bpm')).toHaveText('100');
  await expect(page.locator('#debug-offset')).toHaveText('200 ms');
  await page.reload();
  await expect(page.locator('#restart')).toBeEnabled();
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#bpm')).toHaveValue('100');
  await expect(page.locator('#offset')).toHaveValue('200');
  const dimensions = await page.locator('#game-canvas').evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, rect: canvas.getBoundingClientRect().width, dpr: devicePixelRatio }));
  expect(dimensions.width).toBe(Math.round(dimensions.rect * dimensions.dpr));
  expect(await page.locator('.video-frame').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('result preserves normal video playback and skipped notes never inflate score', async ({ page }) => {
  await seekPlay(page, 45);
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#score')).toHaveText('000000');
  await expect(page.locator('#result-accuracy')).toContainText('スキップ');
  expect(await page.evaluate(() => (window as any).testVideo.getPlayerState())).toBe(1);
});

test('IFrame errors stop the game and retain the official video link', async ({ page }) => {
  await seekPlay(page, 12);
  await page.evaluate(() => {
    const video = (window as any).testVideo;
    video.options.events.onError({ target: video, data: 153 });
  });
  await expect(page.locator('#player-error')).toContainText('Referer');
  await expect(page.locator('#restart')).toBeDisabled();
  await page.keyboard.press('s');
  await expect(page.locator('#score')).toHaveText('000000');
  await expect(page.locator('.playback-info a')).toHaveAttribute('href', 'https://www.youtube.com/watch?v=pJDfWpZ7CI4');
});

test('video time moves the canvas, overdue notes MISS once, and pause retains judgement', async ({ page }) => {
  await seekPlay(page, 12);
  const before = await page.locator('#game-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.evaluate(() => (window as any).testVideo.seekTo(12.2));
  await expect(page.locator('#judgement')).toHaveText('MISS');
  const after = await page.locator('#game-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  expect(after).not.toBe(before);
  await page.evaluate(() => (window as any).testVideo.setState(2));
  const paused = await page.locator('#game-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.waitForTimeout(100);
  expect(await page.locator('#game-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(paused);
  expect(await page.evaluate(() => (window as any).testVideo.options.playerVars)).toMatchObject({ origin: 'http://127.0.0.1:5173', playsinline: 1, controls: 1, autoplay: 0 });
});
