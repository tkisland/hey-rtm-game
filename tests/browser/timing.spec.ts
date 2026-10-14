import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { api, seekPlay } from './mock-video';
const chart = { videoId: 'pJDfWpZ7CI4', title: 'SUPER MOMMY GIRLS', bpm: 120, startTime: 12, beatOrigin: 12, notes: [{ id: 1, time: 12, lane: 0, type: 'tap' }, { id: 2, time: 14, lane: 3, type: 'tap' }] };
async function game(page: Page, notes: unknown = chart.notes) {
  await page.goto('/');
  await page.evaluate(data => localStorage.setItem('hey-rhythm-custom-chart-v1', JSON.stringify(data)), { ...chart, notes });
  await page.goto('/?chart=custom'); await expect(page.locator('#restart')).toBeEnabled();
}
async function range(page: Page, id: string, value: string) { await page.locator(`#${id}`).fill(value); await page.locator(`#${id}`).dispatchEvent('input'); }
async function audioSpy(page: Page) {
  await page.evaluate(() => {
    (window as any).audioEvents = [];
    const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (...args) { (window as any).audioEvents.push({ kind: 'start', when: args[0], now: this.context.currentTime }); return start.apply(this, args); };
    AudioBufferSourceNode.prototype.stop = function (...args) { (window as any).audioEvents.push({ kind: 'stop' }); return stop.apply(this, args); };
  });
}
const starts = (page: Page) => page.evaluate(() => (window as any).audioEvents.filter((event: any) => event.kind === 'start'));
const stops = (page: Page) => page.evaluate(() => (window as any).audioEvents.filter((event: any) => event.kind === 'stop').length);
test.beforeEach(async ({ page }) => { await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: api })); });

test('input correction works after the original MISS deadline and audio delay does not delay judgement', async ({ page }) => {
  await game(page); await audioSpy(page); await page.locator('#settings-toggle').click();
  await page.locator('#sound-test').click(); await expect.poll(() => starts(page).then(events => events.length)).toBe(1);
  await range(page, 'offset', '100'); await range(page, 'input-offset', '300'); await range(page, 'sound-delay', '150');
  await page.locator('#debug-toggle').check(); await page.locator('#settings-close').click();
  await seekPlay(page, 12.38); await page.keyboard.press('s');
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('PERFECT'); await expect(page.locator('#score')).toHaveText('001000');
  await expect.poll(() => starts(page).then(events => events.length)).toBe(2);
  const delayed = (await starts(page))[1]; expect(delayed.when - delayed.now).toBeGreaterThan(0.12); expect(delayed.when - delayed.now).toBeLessThanOrEqual(0.151);
  await expect(page.locator('#debug-input-offset')).toHaveText('300 ms');
  const clocks = await page.evaluate(() => ({ visual: parseFloat(document.getElementById('debug-game-time')!.textContent!), judged: parseFloat(document.getElementById('debug-input-time')!.textContent!) }));
  expect(clocks.visual - clocks.judged).toBeCloseTo(0.3, 2);
  await page.reload(); await page.locator('#settings-toggle').click();
  await expect(page.locator('#input-offset')).toHaveValue('300'); await expect(page.locator('#sound-delay')).toHaveValue('150');
  await page.locator('#timing-reset').click(); await expect(page.locator('#input-offset')).toHaveValue('0'); await expect(page.locator('#sound-delay')).toHaveValue('0'); await expect(page.locator('#offset')).toHaveValue('100');
});

test('negative correction accepts early taps and positive correction applies at hold endpoints', async ({ page }) => {
  await game(page); await page.locator('#settings-toggle').click(); await range(page, 'input-offset', '-100'); await page.locator('#settings-close').click();
  await seekPlay(page, 11.89); await page.keyboard.press('s'); await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('PERFECT');
  await game(page, [{ id: 1, time: 12, endTime: 12.9, lane: 0, type: 'hold' }]);
  await page.locator('#settings-toggle').click(); await range(page, 'input-offset', '200'); await page.locator('#settings-close').click();
  await seekPlay(page, 12.19); await page.keyboard.down('s'); await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('HOLD');
  await expect(page.locator('#score')).toHaveText('000000');
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('PERFECT'); await page.keyboard.up('s'); await expect(page.locator('#score')).toHaveText('001000');
});

test('editor tap and hold recordings compensate input while preserving hold length and shared settings', async ({ page }) => {
  await page.goto('/editor.html'); await expect(page.locator('#record-toggle')).toBeEnabled();
  await page.locator('.timing-settings summary').click(); await range(page, 'editor-input-offset', '100'); await range(page, 'editor-sound-delay', '80');
  await page.evaluate(() => {
    (window as any).inputTimes = [];
    for (const type of ['keydown', 'keyup']) window.addEventListener(type, event => {
      if ((event as KeyboardEvent).code === 'KeyS' || (event as KeyboardEvent).code === 'KeyD') (window as any).inputTimes.push({ type, time: (window as any).testVideo.getCurrentTime() });
    }, true);
  });
  await page.locator('#record-toggle').click(); await seekPlay(page, 12.2); await page.keyboard.press('s');
  await page.locator('#record-type').selectOption('hold'); await page.locator('#record-pads').focus();
  await page.keyboard.down('d'); await page.waitForTimeout(180); await page.keyboard.up('d');
  await expect(page.locator('#note-count')).toHaveText('2 NOTES'); await expect(page.locator('#save-status')).toContainText('保存しました');
  const data = await page.evaluate(() => ({ chart: JSON.parse(localStorage.getItem('hey-rhythm-editor-v1')!), inputs: (window as any).inputTimes }));
  const tap = data.chart.notes.find((note: any) => note.type === 'tap'), hold = data.chart.notes.find((note: any) => note.type === 'hold');
  expect(tap.time).toBeCloseTo(data.inputs[0].time - 0.1, 2); expect(hold.time).toBeCloseTo(data.inputs[2].time - 0.1, 2); expect(hold.endTime).toBeCloseTo(data.inputs[3].time - 0.1, 2);
  expect(hold.sourceTime).toBe(hold.time); expect(hold.sourceEndTime).toBe(hold.endTime);
  await page.locator('#try-game').click(); await page.locator('#settings-toggle').click(); await expect(page.locator('#input-offset')).toHaveValue('100'); await expect(page.locator('#sound-delay')).toHaveValue('80');
});

test('queued audio is cancelled on OFF, zero volume, changed delay and restart', async ({ page }) => {
  await game(page); await audioSpy(page); await page.locator('#settings-toggle').click();
  await page.locator('#sound-test').click(); await expect.poll(() => starts(page).then(events => events.length)).toBe(1);
  await range(page, 'sound-delay', '300'); await page.locator('#sound-test').click(); await page.locator('#sound-toggle').uncheck(); await expect.poll(() => stops(page)).toBe(1);
  await page.locator('#sound-toggle').check(); await page.locator('#sound-test').click(); await range(page, 'sound-volume', '0'); await expect.poll(() => stops(page)).toBe(2);
  await range(page, 'sound-volume', '70'); await page.locator('#sound-test').click(); await range(page, 'sound-delay', '250'); await expect.poll(() => stops(page)).toBe(3);
  await page.locator('#sound-test').click(); await page.locator('#settings-close').click(); await page.locator('#restart').click(); await expect.poll(() => stops(page)).toBe(4);
});

test('paused or seeked playback cancels future clicks and settings still work when storage fails', async ({ page }) => {
  await game(page); await audioSpy(page); await page.locator('#settings-toggle').click(); await page.locator('#sound-test').click(); await expect.poll(() => starts(page).then(events => events.length)).toBe(1);
  await range(page, 'sound-delay', '300'); await page.locator('#settings-close').click(); await seekPlay(page, 12);
  await page.keyboard.press('s'); await page.evaluate(() => (window as any).testVideo.setState(2)); await expect.poll(() => stops(page)).toBe(1);
  await page.evaluate(() => (window as any).testVideo.playVideo()); await page.keyboard.press('f'); await page.evaluate(() => (window as any).testVideo.seekTo(20)); await expect.poll(() => stops(page)).toBe(2);
  await page.locator('#settings-toggle').click(); await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
  await range(page, 'input-offset', '85'); await range(page, 'sound-delay', '125'); await expect(page.locator('#storage-status')).toContainText('保存ができません');
  await expect(page.locator('#input-offset-value')).toHaveText('+85 ms'); await expect(page.locator('#sound-delay-value')).toHaveText('125 ms');
});

test('a cancelled AudioContext resume cannot play an obsolete delayed click', async ({ page }) => {
  await game(page); await page.locator('#settings-toggle').click(); await page.locator('#sound-test').click(); await audioSpy(page);
  const result = await page.evaluate(async () => {
    const { TapSound } = await import('/src/sound.ts');
    const sound = new TapSound(() => { throw new Error('Audio failed'); });
    sound.play(0); await new Promise(resolve => setTimeout(resolve, 80));
    const originalResume = AudioContext.prototype.resume;
    let resolveResume: (() => void) | null = null;
    const context = (sound as any).context as AudioContext;
    await context.suspend();
    AudioContext.prototype.resume = function () { return new Promise<void>(resolve => { resolveResume = () => { void originalResume.call(this).then(resolve); }; }); };
    (window as any).audioEvents = [];
    try {
      sound.delay = 200; sound.play(1); sound.cancelPending();
      resolveResume!(); await new Promise(resolve => setTimeout(resolve, 40));
      return (window as any).audioEvents.filter((event: any) => event.kind === 'start').length;
    } finally { AudioContext.prototype.resume = originalResume; sound.destroy(); }
  });
  expect(result).toBe(0);
});
