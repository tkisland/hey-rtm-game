import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { api } from './mock-video';
import { DEFAULT_SETTINGS } from '../../src/settings';
const chart = {
  videoId: 'pJDfWpZ7CI4', title: 'SUPER MOMMY GIRLS', bpm: 120, startTime: 3.5, beatOrigin: 3.5,
  notes: [
    { id: 1, lane: 0, type: 'tap', time: 3.5, sourceTime: 3.49 },
    { id: 2, lane: 1, type: 'hold', time: 4, endTime: 6, sourceTime: 3.99, sourceEndTime: 6.01 },
    { id: 3, lane: 4, type: 'tap', time: 4 },
    { id: 4, lane: 2, type: 'tap', time: 8 },
  ],
};
async function importChart(page: Page, data: unknown = chart) {
  await page.locator('#import-chart').setInputFiles({ name: 'chart.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.locator('#save-status')).toContainText('保存しました');
}
async function selectNote(page: Page, id: number) {
  const summary = page.getByText('表示範囲のノーツ一覧（最大100個）', { exact: true });
  if (!(await summary.evaluate(node => (node.parentElement as HTMLDetailsElement).open))) await summary.click();
  await page.getByRole('button', { name: `ノーツ${id}を選択`, exact: true }).click();
}
async function spy(page: Page) {
  await page.evaluate(() => {
    (window as any).previewSounds = [];
    (window as any).previewStates = [];
    new MutationObserver(() => {
      (window as any).previewStates.push([...document.querySelectorAll<HTMLElement>('#preview-lanes [data-lane]')].map(lane => lane.dataset.state));
    }).observe(document.getElementById('preview-lanes')!, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) {
      // Count note-start/end cues separately from the sustained hold voice.
      if (!this.loop) (window as any).previewSounds.push({ when: args[0], now: this.context.currentTime });
      return start.apply(this, args);
    };
  });
}
const sounds = (page: Page) => page.evaluate(() => (window as any).previewSounds.length as number);
const videoTime = (page: Page) => page.evaluate(() => (window as any).testVideo.getCurrentTime() as number);
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-editor-v1')!));
test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ body: api }));
  await page.goto('/editor.html'); await expect(page.locator('#record-toggle')).toBeEnabled();
});

test('previews taps, holds and chords with pause/resume, without recording or changing the chart', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('hey-rhythm-settings-v1', JSON.stringify({ inputOffset: 250, soundDelay: 200, soundVolume: 70 })));
  await page.reload(); await importChart(page);
  const before = await stored(page);
  await page.locator('#audition').check(); // Legacy audition must not duplicate the preview sounds.
  await spy(page); await page.locator('#record-toggle').click();
  await page.locator('#preview-first').click();
  await expect(page.locator('#record-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#preview-status')).toContainText('プレビュー再生中');
  const start = chart.notes[0].time - DEFAULT_SETTINGS.travel - .5;
  expect(await videoTime(page)).toBeGreaterThanOrEqual(start);
  expect(await videoTime(page)).toBeLessThan(start + .6);
  expect(await sounds(page)).toBe(0); // Audio unlock has no warm-up click.
  await expect.poll(() => sounds(page)).toBe(3);
  await expect(page.locator('#preview-lanes [data-lane="1"]')).toHaveAttribute('data-state', 'holding');
  await expect(page.locator('#preview-lanes [data-lane="1"] output')).toHaveText('HOLD');
  expect(await page.evaluate(() => (window as any).previewStates.some((states: string[]) => states[1] === 'holding' && states[4] === 'pulse'))).toBe(true);
  await page.keyboard.press('f');
  await page.locator('#preview-pause').click();
  await expect(page.locator('#preview-status')).toContainText('一時停止');
  const paused = await videoTime(page);
  await page.waitForTimeout(200);
  expect(await videoTime(page)).toBeCloseTo(paused, 3); expect(await sounds(page)).toBe(3);
  await page.locator('#preview-play').click();
  await expect.poll(() => sounds(page)).toBe(4); // Hold release gets its own cue.
  await expect(page.locator('#preview-lanes [data-lane="1"]')).not.toHaveAttribute('data-state', 'holding');
  await expect.poll(() => sounds(page)).toBe(5);
  await expect(page.locator('#preview-status')).toContainText('プレビュー完了');
  expect(await page.evaluate(() => (window as any).testVideo.state)).toBe(2);
  await expect(page.locator('#note-count')).toHaveText('4 NOTES');
  expect(await stored(page)).toEqual(before);
  const events = await page.evaluate(() => (window as any).previewSounds as {when: number; now: number}[]);
  for (const event of events) expect(event.when - event.now).toBeLessThan(0.01); // Added input sound delay is bypassed.
});

test('starts before the selected note and stops when a note is edited, retaining source timing', async ({ page }) => {
  await importChart(page); await expect(page.locator('#preview-selected')).toBeDisabled();
  await selectNote(page, 2); await page.locator('#preview-selected').click();
  await expect(page.locator('#preview-status')).toContainText('プレビュー再生中');
  const start = chart.notes[1].time - DEFAULT_SETTINGS.travel - .5;
  expect(await videoTime(page)).toBeGreaterThanOrEqual(start); expect(await videoTime(page)).toBeLessThan(start + .6);
  await page.locator('#nudge-plus').click();
  await expect(page.locator('#preview-status')).toContainText('停止中');
  expect(await page.evaluate(() => (window as any).testVideo.state)).toBe(2);
  await expect(page.locator('#note-time')).toHaveValue('4.010');
  await expect(page.locator('#save-status')).toContainText('保存しました');
  expect((await stored(page)).notes.find((note: any) => note.id === 2)).toMatchObject({ time: 4.01, endTime: 6.01, sourceTime: 3.99, sourceEndTime: 6.01 });
  await page.locator('#preview-first').click();
  await page.locator('#record-toggle').click();
  await expect(page.locator('#preview-status')).toContainText('停止中');
  await expect(page.locator('#record-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('waits for an asynchronous seek and cancelling it cannot resume playback or sound skipped notes', async ({ page }) => {
  await importChart(page); await spy(page);
  await page.evaluate(() => {
    const video = (window as any).testVideo;
    video.seekTo(70); video.setState(2);
    video.actualSeek = video.seekTo.bind(video);
    video.seekTo = (time: number) => { video.pendingTarget = time; };
  });
  await page.locator('#preview-first').click();
  await expect(page.locator('#preview-status')).toContainText('移動中');
  expect(await sounds(page)).toBe(0);
  await page.locator('#preview-stop').click();
  await page.evaluate(() => {
    const video = (window as any).testVideo; video.actualSeek(video.pendingTarget); video.seekTo = video.actualSeek;
  });
  await expect(page.locator('#preview-status')).toContainText('停止中');
  expect(await page.evaluate(() => (window as any).testVideo.state)).toBe(2);
  expect(await sounds(page)).toBe(0);
  await page.locator('#preview-play').click();
  await expect(page.locator('#preview-status')).toContainText('プレビュー再生中');
  await page.evaluate(() => (window as any).testVideo.seekTo(7.5));
  await page.waitForTimeout(120); expect(await sounds(page)).toBe(0);
  await expect.poll(() => sounds(page)).toBe(1); // Only the remaining note at 8s.
});

test('audio can be muted and a note at video zero plays on explicit restart', async ({ page }) => {
  const zero = { ...chart, startTime: 0, beatOrigin: 0, notes: [{ id: 1, lane: 0, type: 'tap', time: 0 }, { id: 2, lane: 4, type: 'hold', time: 0, endTime: 1 }] };
  await importChart(page, zero); await spy(page);
  await page.locator('#preview-sound').uncheck();
  await page.locator('#preview-first').click();
  await expect(page.locator('#preview-lanes [data-lane="4"]')).toHaveAttribute('data-state', 'holding');
  await expect(page.locator('#preview-status')).toContainText('プレビュー完了');
  expect(await sounds(page)).toBe(0);
  await page.locator('#preview-sound').check(); await page.locator('#preview-first').click();
  await expect.poll(() => sounds(page)).toBe(2);
  await expect.poll(() => sounds(page)).toBe(3);
  await expect(page.locator('#preview-status')).toContainText('プレビュー完了');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('calibration and video errors stop preview while the chart remains editable', async ({ page }) => {
  await expect(page.locator('#preview-play')).toBeDisabled();
  await importChart(page); await spy(page); const before = await stored(page);
  await page.locator('#preview-first').click();
  await page.locator('.timing-settings summary').click(); await page.locator('#editor-auto-calibrate').click();
  await expect(page.locator('.calibration-dialog')).toBeVisible();
  expect(await page.evaluate(() => (window as any).testVideo.state)).toBe(2);
  await page.locator('#calibration-close').click();
  await expect(page.locator('#preview-status')).toContainText('停止中');
  expect(await sounds(page)).toBe(0);
  await page.locator('#preview-first').click();
  await page.evaluate(() => (window as any).testVideo.options.events.onError({target: (window as any).testVideo, data: 153}));
  await expect(page.locator('#preview-play')).toBeDisabled(); await expect(page.locator('#preview-first')).toBeDisabled();
  await expect(page.locator('#preview-status')).toContainText('動画を再生できません');
  expect(await stored(page)).toEqual(before);
});

test('hiding the page stops preview and prevents background playback', async ({ page }) => {
  await importChart(page); await spy(page); await page.locator('#preview-first').click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(() => (window as any).testVideo.state)).toBe(2);
  expect(await sounds(page)).toBe(0);
  await expect(page.locator('#preview-stop')).toBeDisabled();
  await page.evaluate(() => {
    delete (document as any).hidden; document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#preview-status')).toContainText('停止中');
});
