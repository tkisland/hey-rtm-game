import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { api } from './mock-video';

async function live(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).warmSources.filter((voice: any) => !voice.stopped).length);
}
async function count(page: Page, expected: number) { await expect.poll(() => live(page)).toBe(expected); }
async function range(page: Page, id: string, value: string) { await page.locator(`#${id}`).fill(value); await page.locator(`#${id}`).dispatchEvent('input'); }
test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ body: api }));
  await page.addInitScript(() => {
    (window as any).warmSources = []; (window as any).tapSources = []; (window as any).tapRequested = 0;
    const warmStart = ConstantSourceNode.prototype.start, warmStop = ConstantSourceNode.prototype.stop;
    const tapStart = AudioBufferSourceNode.prototype.start;
    ConstantSourceNode.prototype.start = function(...args) {
      (window as any).warmSources.push({ node: this, offset: this.offset.value, stopped: false });
      return warmStart.apply(this, args);
    };
    ConstantSourceNode.prototype.stop = function(...args) {
      const voice = (window as any).warmSources.find((voice: any) => voice.node === this);
      if (voice) voice.stopped = true;
      return warmStop.apply(this, args);
    };
    AudioBufferSourceNode.prototype.start = function(...args) {
      (window as any).tapSources.push({ requested: (window as any).tapRequested, actual: performance.now(), when: args[0], now: this.context.currentTime });
      return tapStart.apply(this, args);
    };
    document.addEventListener('keydown', () => { (window as any).tapRequested = performance.now(); }, true);
  });
  await page.goto('/game.html'); await expect(page.locator('#play-start')).toBeEnabled();
});

test('output processes exact silence throughout the intro before the first eight taps', async ({ page }) => {
  await count(page, 0);
  await page.locator('#play-start').click(); await count(page, 1);
  // The first note is at 7.65s. No taps are needed to open/keep the output running.
  await page.waitForTimeout(7800);
  await count(page, 1);
  const warm = await page.evaluate(() => ({
    sources: (window as any).warmSources.map((voice: any) => ({ offset: voice.offset, stopped: voice.stopped, time: voice.node.context.currentTime })),
    taps: (window as any).tapSources.length,
  }));
  expect(warm.taps).toBe(0); expect(warm.sources.every((voice: any) => voice.offset === 0)).toBe(true);
  expect(warm.sources.find((voice: any) => !voice.stopped)!.time).toBeGreaterThan(7.5);
  for (const key of ['s', 'd', 'f', 'j', 'k', 'l', 's', 'd']) await page.keyboard.press(key);
  const taps = await page.evaluate(() => (window as any).tapSources);
  expect(taps).toHaveLength(8);
  for (const tap of taps) { expect(tap.actual - tap.requested).toBeLessThan(80); expect(tap.when - tap.now).toBeLessThan(.003); }
  await count(page, 1);
  await page.evaluate(() => (window as any).testVideo.setState(0)); await count(page, 0);
});

test('native video playback leaves a parent gesture available to prepare audio without seeking or replaying', async ({ page }) => {
  await page.evaluate(() => { const video = (window as any).testVideo; video.seekTo(3.4); video.playVideo(); });
  const button = page.locator('#play-start');
  await expect(button).toBeEnabled(); await expect(button).toHaveText('♫ 音声');
  await page.evaluate(() => {
    const video = (window as any).testVideo; video.seekTo = () => { throw new Error('Unexpected seek'); };
    video.playVideo = () => { throw new Error('Unexpected play'); };
  });
  await button.click(); await count(page, 1);
  const time = await page.evaluate(() => (window as any).testVideo.getCurrentTime());
  expect(time).toBeGreaterThanOrEqual(3.4); expect(time).toBeLessThan(4.5);
  expect(await page.evaluate(() => (window as any).tapSources.length)).toBe(0);
});

test('mute, pause, buffering, stale clock, hidden tab and error stop the silent output; resume restarts one', async ({ page }) => {
  await page.locator('#play-start').click(); await count(page, 1);
  await page.locator('#settings-toggle').click();
  await range(page, 'sound-volume', '0'); await count(page, 0);
  await range(page, 'sound-volume', '70'); await count(page, 1);
  await page.locator('#sound-toggle').uncheck(); await count(page, 0);
  await page.locator('#sound-toggle').check(); await count(page, 1);
  await page.locator('#settings-close').click();
  for (const state of [2, 3]) {
    await page.evaluate(state => (window as any).testVideo.setState(state), state); await count(page, 0);
    await page.evaluate(() => (window as any).testVideo.playVideo()); await count(page, 1);
  }
  await page.evaluate(() => {
    const video = (window as any).testVideo; video.time = video.getCurrentTime(); video.liveClock = false;
  });
  await expect(page.locator('#player-status')).toContainText('更新待ち'); await count(page, 0);
  await page.evaluate(() => { const video = (window as any).testVideo; video.seekTo(video.time + 1); video.liveClock = true; });
  await count(page, 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));
  });
  await count(page, 0); await page.waitForTimeout(150); await count(page, 0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));
  });
  await count(page, 1);
  await page.evaluate(() => { const video = (window as any).testVideo; video.options.events.onError({ target: video, data: 153 }); });
  await count(page, 0);
});

test('a stopped or muted warmup never returns after a delayed resume or disposal', async ({ page }) => {
  await page.locator('#play-start').click();
  const result = await page.evaluate(async () => {
    const { TapSound } = await import('/src/sound.ts');
    const errors: string[] = [], sound = new TapSound(() => errors.push('unavailable'));
    await sound.unlock(); const context = (sound as any).context as AudioContext; await context.suspend();
    const resume = AudioContext.prototype.resume; let release!: () => void;
    AudioContext.prototype.resume = function() { return new Promise<void>((resolve, reject) => { release = () => { void resume.call(this).then(resolve, reject); }; }); };
    const current = () => (window as any).warmSources.filter((voice: any) => voice.node.context === context && !voice.stopped).length;
    try {
      sound.setPlaybackActive(true); const started = current(); const pending = sound.unlock();
      sound.setPlaybackActive(false); sound.cancelPending(); release(); await pending;
      const stopped = current(); sound.enabled = false; sound.setPlaybackActive(true); await sound.unlock();
      const muted = current(); sound.enabled = true; const restored = current(); sound.destroy();
      return { started, stopped, muted, restored, disposed: current(), errors };
    } finally { AudioContext.prototype.resume = resume; sound.destroy(); }
  });
  expect(result).toEqual({ started: 1, stopped: 0, muted: 0, restored: 1, disposed: 0, errors: [] });
});

test('editor recording and preview warm only the active sound output before note input', async ({ page }) => {
  await page.goto('/editor.html'); await expect(page.locator('#record-toggle')).toBeEnabled(); await count(page, 0);
  const chart = { videoId: 'pJDfWpZ7CI4', title: 'test', bpm: 120, startTime: 5,
    notes: [{ id: 1, time: 5, lane: 0, type: 'hold', endTime: 9 }] };
  await page.locator('#import-chart').setInputFiles({ name: 'test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(chart)) });
  await page.evaluate(() => (window as any).testVideo.playVideo()); await count(page, 1);
  await page.locator('#record-toggle').click(); await count(page, 1);
  await page.locator('#preview-first').click(); await count(page, 1);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as any).tapSources.length)).toBe(0);
  await page.locator('#preview-pause').click(); await count(page, 0);
  await page.locator('#preview-play').click(); await count(page, 1);
  await page.locator('#preview-sound').uncheck(); await count(page, 0);
  await page.locator('#preview-sound').check(); await count(page, 1);
  await page.locator('#preview-stop').click(); await count(page, 0);
});
