import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { api } from './mock-video';

// Only the audio clock is advanced for fast, deterministic UI measurements. Native Web Audio
// nodes are still created and scheduled. This does not measure physical speakers or input latency.
async function clockAdapter(page: Page) {
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    (window as any).calibrationClock = 0;
    (window as any).referenceStarts = [];
    (window as any).referenceStops = [];
    (window as any).clickStarts = [];
    (window as any).testAudioContexts = [];
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options); (window as any).testAudioContexts.push(this);
      }
      get currentTime() { return (window as any).calibrationClock; }
    };
    const start = OscillatorNode.prototype.start, stop = OscillatorNode.prototype.stop;
    OscillatorNode.prototype.start = function(when) { (window as any).referenceStarts.push(when); return start.call(this, when); };
    OscillatorNode.prototype.stop = function(when) { (window as any).referenceStops.push(when ?? 0); return stop.call(this, when); };
    const click = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) { (window as any).clickStarts.push(args[0]); return click.apply(this, args); };
  });
}
async function advance(page: Page, time: number) {
  await page.evaluate(async time => {
    (window as any).calibrationClock = time;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, time);
}
async function begin(page: Page) {
  await page.locator('#calibration-start').click();
  await expect(page.locator('#calibration-tap')).toBeEnabled();
  const times = await page.evaluate(() => (window as any).referenceStarts.slice(-14) as number[]);
  expect(times).toHaveLength(14);
  for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(0.9);
  // Warmup taps are ignored.
  for (let beat = 0; beat < 4; beat++) {
    await advance(page, times[beat]); await page.keyboard.press('KeyS');
  }
  await expect(page.locator('#calibration-progress')).toHaveJSProperty('value', 0);
  return times;
}
async function taps(page: Page, times: number[], offsets: number[], touch: boolean) {
  for (let beat = 0; beat < offsets.length; beat++) {
    await advance(page, times[beat + 4] + offsets[beat] / 1000);
    if (touch) await page.locator('#calibration-tap').tap(); else await page.keyboard.press('KeyF');
  }
  // Complete without jumping past the interruption guard.
  for (let beat = offsets.length; beat < 10; beat++) await advance(page, times[beat + 4]);
  await advance(page, times[13] + 0.41);
}
test.beforeEach(async ({ page }) => { await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ body: api })); });

test('reference taps replace the input correction, preserve other settings, and are shared with the editor', async ({ page }, info) => {
  await clockAdapter(page);
  await page.goto('/game.html?chart=test');
  await page.evaluate(() => localStorage.setItem('hey-rhythm-settings-v1', JSON.stringify({noteOffset:0,inputOffset: 140, soundDelay: 150, sound: false, soundVolume: 0, noteSize: 80 })));
  await page.reload(); await expect(page.locator('#restart')).toBeEnabled();
  await page.evaluate(() => (window as any).testVideo.playVideo());
  await page.locator('#settings-toggle').click(); await page.locator('#auto-calibrate').click();
  await expect(page.locator('.calibration-dialog')).toBeVisible();
  expect(await page.evaluate(() => (window as any).testVideo.state)).toBe(2);
  const times = await begin(page);
  await taps(page, times, Array(10).fill(80), info.project.name === 'mobile-touch');
  await expect(page.locator('#calibration-status')).toContainText('+80 ms');
  // Explicit application only, and old compensation is not added to the measured value.
  await expect(page.locator('#input-offset')).toHaveValue('140');
  await page.locator('#calibration-apply').click();
  await expect(page.locator('.calibration-dialog')).not.toBeVisible();
  await expect(page.locator('#input-offset')).toHaveValue('80');
  await expect(page.locator('#sound-delay')).toHaveValue('150');
  await expect(page.locator('#note-size')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).clickStarts)).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!))).toMatchObject({ inputOffset: 80, soundDelay: 150, sound: false, soundVolume: 0 });
  await page.goto('/editor.html'); await page.locator('.timing-settings summary').click();
  await expect(page.locator('#editor-input-offset')).toHaveValue('80');
});

test('editor calibration stops recording and ignores duplicate and held keyboard input', async ({ page }) => {
  await clockAdapter(page); await page.goto('/editor.html');
  await expect(page.locator('#record-toggle')).toBeEnabled();
  await page.locator('#record-toggle').click();
  await page.evaluate(() => (window as any).testVideo.playVideo());
  await page.locator('.timing-settings summary').click(); await page.locator('#editor-auto-calibrate').click();
  await expect(page.locator('#record-toggle')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => (window as any).testVideo.state)).toBe(2);
  const times = await begin(page);
  for (let beat = 0; beat < 10; beat++) {
    await advance(page, times[beat + 4] - 0.1);
    await page.keyboard.down('KeyF'); await page.keyboard.down('KeyF');
    await page.keyboard.press('KeyJ'); await page.keyboard.up('KeyF');
  }
  await advance(page, times[13] + 0.41);
  await expect(page.locator('#calibration-status')).toContainText('-100 ms');
  await expect(page.locator('#note-count')).toHaveText('0 NOTES');
  await page.locator('#calibration-apply').click();
  await expect(page.locator('#editor-input-offset')).toHaveValue('-100');
  expect(await page.evaluate(() => (window as any).clickStarts)).toEqual([]);
});

test('failed, cancelled and interrupted measurements never overwrite saved correction', async ({ page }) => {
  await clockAdapter(page); await page.goto('/game.html?chart=test');
  await page.locator('#settings-toggle').click();
  await page.locator('#input-offset').fill('120'); await page.locator('#input-offset').dispatchEvent('input');
  await page.locator('#auto-calibrate').click();
  const times = await begin(page);
  await taps(page, times, Array(7).fill(80), false);
  await expect(page.locator('#calibration-status')).toContainText('タップが足りません');
  await expect(page.locator('#calibration-apply')).toBeDisabled();
  await page.locator('#calibration-close').click();
  await expect(page.locator('#input-offset')).toHaveValue('120');
  // Background interruption cancels every scheduled reference and the pending result.
  await page.locator('#auto-calibrate').click(); await page.locator('#calibration-start').click();
  await expect(page.locator('#calibration-tap')).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#calibration-status')).toContainText('中断');
  await expect(page.locator('#calibration-tap')).toBeDisabled();
  expect(await page.evaluate(() => (window as any).referenceStops.filter((when: number) => when === 0).length)).toBe(28);
  await expect(page.locator('#calibration-apply')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.calibration-dialog')).not.toBeVisible();
  await expect(page.locator('#input-offset')).toHaveValue('120');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!).inputOffset)).toBe(120);
});

test('real audio reference uses its own clock and closes all nodes on cancel', async ({ page }) => {
  await page.goto('/game.html?chart=test'); await page.locator('#settings-toggle').click();
  await page.evaluate(() => {
    (window as any).realReferences = [];
    (window as any).cancelledReferences = 0;
    const start = OscillatorNode.prototype.start, stop = OscillatorNode.prototype.stop;
    OscillatorNode.prototype.start = function(when) { (window as any).realReferences.push({ when, now: this.context.currentTime }); return start.call(this, when); };
    OscillatorNode.prototype.stop = function(when) { if (when === undefined) (window as any).cancelledReferences++; return stop.call(this, when); };
  });
  await page.locator('#auto-calibrate').click(); await page.locator('#calibration-start').click();
  await expect(page.locator('#calibration-tap')).toBeEnabled();
  const scheduled = await page.evaluate(() => (window as any).realReferences as {when: number; now: number}[]);
  expect(scheduled.length).toBe(14);
  expect(scheduled[0].when - scheduled[0].now).toBeGreaterThan(0.7);
  for (let i = 1; i < scheduled.length; i++) expect(scheduled[i].when - scheduled[i - 1].when).toBeCloseTo(0.9);
  await page.locator('#calibration-close').click();
  await expect.poll(() => page.evaluate(() => (window as any).cancelledReferences)).toBe(14);
});

test('audio startup failure can retry and a cancelled resume cannot schedule late tones', async ({ page }) => {
  await clockAdapter(page); await page.goto('/game.html?chart=test'); await page.locator('#settings-toggle').click();
  await page.evaluate(() => {
    (window as any).originalResume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = () => Promise.reject(new Error('test audio failure'));
  });
  await page.locator('#auto-calibrate').click(); await page.locator('#calibration-start').click();
  await expect(page.locator('#calibration-status')).toContainText('基準音を再生できません');
  await expect(page.locator('#calibration-start')).toBeEnabled();
  await expect(page.locator('#calibration-apply')).toBeDisabled();
  await page.evaluate(() => {
    AudioContext.prototype.resume = () => new Promise<void>(resolve => { (window as any).releaseResume = resolve; });
  });
  await page.locator('#calibration-start').click();
  await expect(page.locator('#calibration-status')).toContainText('準備しています');
  await page.locator('#calibration-close').click();
  await expect(page.locator('.calibration-dialog')).not.toBeVisible();
  await page.evaluate(async () => {
    (window as any).releaseResume();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });
  expect(await page.evaluate(() => (window as any).referenceStarts)).toEqual([]);
  await expect(page.locator('#input-offset')).toHaveValue('0');
});
