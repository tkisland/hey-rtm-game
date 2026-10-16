import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { api, seekPlay } from './mock-video';

const chart = { videoId: 'pJDfWpZ7CI4', title: 'test', bpm: 120, startTime: 12,
  notes: [0, 5].map(lane => ({ id: lane + 1, lane, time: 12, endTime: 18, type: 'hold' })),
};
const live = (page: Page) => page.evaluate(() => (window as any).holdAudio.filter((event: any) => !event.ended).map((event: any) => event.id) as number[]);
async function count(page: Page, count: number) { await expect.poll(() => live(page).then(ids => ids.length)).toBe(count); }
async function range(page: Page, id: string, value: string) { await page.locator(`#${id}`).fill(value); await page.locator(`#${id}`).dispatchEvent('input'); }

test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ body: api }));
  await page.addInitScript(chart => {
    if (!localStorage.getItem('hey-rhythm-custom-chart-v1')) localStorage.setItem('hey-rhythm-custom-chart-v1', JSON.stringify(chart));
    if (!localStorage.getItem('hey-rhythm-settings-v1')) localStorage.setItem('hey-rhythm-settings-v1', JSON.stringify({ sound: true }));
    (window as any).holdAudio = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) {
      if (this.loop) {
        const analyser = this.context.createAnalyser(); this.connect(analyser);
        const event = { id: (window as any).holdAudio.length, when: args[0], now: this.context.currentTime, duration: this.buffer?.duration, ended: false, analyser };
        (window as any).holdAudio.push(event);
        this.addEventListener('ended', () => { event.ended = true; analyser.disconnect(); });
      }
      return start.apply(this, args);
    };
  }, chart);
  await page.goto('/game.html?chart=custom'); await expect(page.locator('#restart')).toBeEnabled();
});

test('two touch holds keep sounding beyond the cymbal; lifting one stops only its voice', async ({ page }) => {
  await page.locator('.lane-buttons').scrollIntoViewIfNeeded();
  const touches = await Promise.all([0, 5].map(async lane => {
    const r = (await page.locator(`.lane-button[data-lane="${lane}"]`).boundingBox())!;
    return { id: lane + 1, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }));
  const session = await page.context().newCDPSession(page);
  await seekPlay(page, 12); await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
  await count(page, 2); const initial = await live(page);
  await page.waitForTimeout(550);
  const levels = await page.evaluate(() => (window as any).holdAudio.map((event: any) => {
    const samples = new Float32Array(event.analyser.fftSize); event.analyser.getFloatTimeDomainData(samples);
    return { duration: event.duration, rms: Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) };
  }));
  levels.forEach((level: { duration: number; rms: number }) => { expect(level.duration).toBeCloseTo(0.2, 3); expect(level.rms).toBeGreaterThan(0.02); });
  expect(await live(page)).toEqual(initial); // A single looping voice, without retriggering every frame.
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [touches[0]] });
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('MISS'); await count(page, 1);
  expect(await live(page)).toEqual([initial[1]]);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await count(page, 0);
});

test('pause, buffering, seek, restart and focus loss stop sustained voices', async ({ page }) => {
  await seekPlay(page, 12); await page.keyboard.down('s'); await count(page, 1);
  for (const state of [2, 3]) {
    await page.evaluate(state => (window as any).testVideo.setState(state), state); await count(page, 0);
    await page.evaluate(() => (window as any).testVideo.playVideo()); await count(page, 1);
  }
  await page.evaluate(() => (window as any).testVideo.seekTo(20)); await count(page, 0);
  await page.locator('#restart').click(); await page.keyboard.up('s'); await count(page, 0);
  await seekPlay(page, 12); await page.keyboard.down('s'); await count(page, 1);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await count(page, 0); await page.keyboard.up('s');
});

test('holding past the endpoint deadline misses and stops the loop; empty presses do not loop', async ({ page }) => {
  await page.evaluate(chart => localStorage.setItem('hey-rhythm-custom-chart-v1', JSON.stringify({ ...chart, notes: [{ ...chart.notes[0], endTime: 13 }] })), chart);
  await page.reload(); await expect(page.locator('#restart')).toBeEnabled();
  await seekPlay(page, 12); await page.keyboard.down('s'); await count(page, 1);
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('MISS'); await count(page, 0);
  await expect(page.locator('.lane-button.pressed')).toHaveCount(1);
  await page.keyboard.up('s'); await page.keyboard.down('d'); await count(page, 0); await page.keyboard.up('d');
});

test('unmuting a cold hold starts audio; OFF, zero volume and release cancel even delayed loops', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('hey-rhythm-settings-v1', JSON.stringify({ sound: false })));
  await page.reload(); await expect(page.locator('#restart')).toBeEnabled();
  await seekPlay(page, 12); await page.keyboard.down('s'); await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('HOLD'); await count(page, 0);
  await page.locator('#settings-toggle').click(); await page.locator('#sound-toggle').check(); await count(page, 1);
  await page.locator('#sound-toggle').uncheck(); await count(page, 0);
  await page.locator('#sound-toggle').check(); await count(page, 1);
  await range(page, 'sound-volume', '0'); await count(page, 0);
  await range(page, 'sound-volume', '70'); await count(page, 1);
  const previous = await page.evaluate(() => (window as any).holdAudio.length);
  await range(page, 'sound-delay', '300');
  await expect.poll(() => page.evaluate(() => (window as any).holdAudio.length)).toBeGreaterThan(previous);
  const delayed = await page.evaluate(() => { const event = (window as any).holdAudio.at(-1); return event.when - event.now; });
  expect(delayed).toBeGreaterThan(0.25); expect(delayed).toBeLessThanOrEqual(0.301);
  await page.keyboard.up('s'); await count(page, 0);
  await page.waitForTimeout(350); await count(page, 0);
});

test('hiding the page stops holds and they cannot reappear in the background', async ({ page }) => {
  await seekPlay(page, 12); await page.keyboard.down('s'); await count(page, 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await count(page, 0); await page.waitForTimeout(350); await count(page, 0);
  await page.keyboard.up('s');
});

test('editor preview sustains holds, cancels on pause, mute and stop, and resumes independently', async ({ page }) => {
  await page.goto('/editor.html'); await expect(page.locator('#record-toggle')).toBeEnabled();
  await page.locator('#import-chart').setInputFiles({ name: 'holds.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(chart)) });
  await page.locator('#preview-first').click(); await count(page, 2);
  await page.waitForTimeout(550); await count(page, 2);
  await page.locator('#preview-pause').click(); await count(page, 0);
  await page.locator('#preview-play').click(); await count(page, 2);
  await page.locator('#preview-sound').uncheck(); await count(page, 0);
  await page.locator('#preview-sound').check(); await count(page, 2);
  await page.locator('#preview-stop').click(); await count(page, 0);
});
