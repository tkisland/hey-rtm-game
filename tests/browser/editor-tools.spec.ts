import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { api, seekPlay } from './mock-video';

const chart = { videoId: 'pJDfWpZ7CI4', title: 'test', bpm: 120, beatOrigin: 0, startTime: 9, notes: [
  { id: 1, lane: 1, time: 9, endTime: 10.5, type: 'hold' },
  { id: 2, lane: 0, time: 10.25, sourceTime: 10.2, type: 'tap' },
  { id: 3, lane: 5, time: 10.25, type: 'tap' },
  { id: 4, lane: 2, time: 11, endTime: 13, sourceTime: 10.99, sourceEndTime: 13.02, type: 'hold' },
  { id: 5, lane: 4, time: 12, type: 'tap' },
] };
async function imported(page: Page, data: unknown = chart) {
  await page.locator('#import-chart').setInputFiles({ name: 'range.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.locator('#editor-notice')).toContainText('読み込みました');
}
async function saved(page: Page) {
  await expect(page.locator('#save-status')).toContainText('保存しました');
  return page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-editor-v1')!));
}
async function choose(page: Page, start = 10, end = 12) {
  if (!(await page.locator('#range-panel').evaluate((node: HTMLDetailsElement) => node.open))) await page.locator('#range-panel summary').click();
  await page.locator('#range-start').fill(String(start)); await page.locator('#range-end').fill(String(end));
  await page.locator('#select-range').click();
}
test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ body: api }));
  await page.goto('/editor.html'); await expect(page.locator('#record-toggle')).toBeEnabled();
});

for (const rate of [0.5, 0.75]) {
  test(`${rate}x records taps and holds in original video seconds, with rate-scaled input correction`, async ({ page }) => {
    await page.locator('#editor-playback-rate').selectOption(String(rate));
    await expect(page.locator('#rate-status')).toContainText(`現在${rate}倍`);
    await page.locator('.timing-settings summary').click();
    await page.locator('#editor-input-offset').fill('100'); await page.locator('#editor-input-offset').dispatchEvent('input');
    await page.evaluate(() => {
      (window as any).recordInputs = [];
      for (const type of ['keydown', 'keyup']) window.addEventListener(type, event => {
        if (['KeyS', 'KeyD'].includes((event as KeyboardEvent).code)) (window as any).recordInputs.push({ type, time: (window as any).testVideo.getCurrentTime(), wall: performance.now() });
      }, true);
    });
    await page.locator('#record-toggle').click(); await seekPlay(page, 12.2); await page.keyboard.press('s');
    await page.locator('#record-type').selectOption('hold'); await page.locator('#record-pads').focus();
    await page.keyboard.down('d'); await page.waitForTimeout(350); await page.keyboard.up('d');
    await expect(page.locator('#note-count')).toHaveText('2 NOTES');
    const data = await saved(page), events = await page.evaluate(() => (window as any).recordInputs);
    const tap = data.notes.find((note: any) => note.type === 'tap'), hold = data.notes.find((note: any) => note.type === 'hold');
    expect(tap.time).toBeCloseTo(events[0].time - 0.1 * rate, 2);
    expect(hold.time).toBeCloseTo(events[2].time - 0.1 * rate, 2);
    expect(hold.endTime).toBeCloseTo(events[3].time - 0.1 * rate, 2);
    expect(hold.endTime - hold.time).toBeCloseTo((events[3].wall - events[2].wall) / 1000 * rate, 2);
    expect(hold.sourceTime).toBe(hold.time); expect(hold.sourceEndTime).toBe(hold.endTime);
    expect(data.bpm).toBe(140);
  });
}

test('changing speed discards an unfinished hold and game playback starts at 1x', async ({ page }) => {
  await page.locator('#record-type').selectOption('hold'); await page.locator('#record-toggle').click();
  await seekPlay(page, 12); await page.keyboard.down('s'); await page.waitForTimeout(100);
  await page.locator('#editor-playback-rate').selectOption('0.5'); await page.keyboard.up('s');
  await expect(page.locator('#note-count')).toHaveText('0 NOTES');
  await page.locator('#record-type').selectOption('tap'); await page.locator('#record-pads').focus(); await page.keyboard.press('d');
  await expect(page.locator('#note-count')).toHaveText('1 NOTES'); const before = await saved(page);
  await page.locator('#try-game').click(); await expect(page.locator('#restart')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).testVideo.getPlaybackRate())).toBe(1);
  expect(await page.locator('#editor-playback-rate').count()).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-custom-chart-v1')!))).toEqual(before);
});

test('slow preview uses the selected rate without stretching stored chart data', async ({ page }) => {
  await imported(page, { ...chart, startTime: 12, notes: [{ id: 1, time: 12, endTime: 12.7, lane: 0, type: 'hold' }] });
  const before = await saved(page);
  await page.locator('#editor-playback-rate').selectOption('0.5'); await page.locator('#preview-sound').uncheck();
  await page.evaluate(() => { const video = (window as any).testVideo; video.setState(2); video.seekTo(11.9); });
  await page.locator('#preview-play').click();
  await expect(page.locator('#preview-lanes [data-lane="0"] output')).toHaveText('HOLD');
  expect(await page.evaluate(() => (window as any).testVideo.getPlaybackRate())).toBe(0.5);
  await expect(page.locator('#preview-status')).toContainText('プレビュー完了');
  expect(await saved(page)).toEqual(before);
});

test('unavailable speeds are disabled and an ignored request reports the actual rate', async ({ page }) => {
  await page.evaluate(() => { (window as any).testVideo.setPlaybackRate = () => {}; });
  await page.locator('#editor-playback-rate').selectOption('0.5');
  await expect(page.locator('#rate-status')).toContainText('切り替えられませんでした');
  await expect(page.locator('#editor-playback-rate')).toHaveValue('1');
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ body: api.replace('return [0.5, 0.75, 1]', 'return [1]') }));
  await page.reload(); await expect(page.locator('#record-toggle')).toBeEnabled();
  await expect(page.locator('#editor-playback-rate option[value="0.5"]')).toHaveJSProperty('disabled', true);
  await expect(page.locator('#editor-playback-rate option[value="0.75"]')).toHaveJSProperty('disabled', true);
});

test('range copy/delete/paste preserves leading rests, chords, full holds and grouped undo', async ({ page }) => {
  await imported(page); const before = await saved(page);
  await choose(page); await expect(page.locator('#range-status')).toContainText('3個');
  await page.locator('#copy-range').click(); await page.locator('#delete-range').click();
  await expect(page.locator('#note-count')).toHaveText('2 NOTES');
  await page.locator('#paste-time').fill('20'); await page.locator('#paste-range').click();
  const pasted = await saved(page);
  expect(pasted.notes.map((note: any) => note.time)).toEqual([9, 12, 20.25, 20.25, 21]);
  expect(pasted.notes.at(-1)).toMatchObject({ time: 21, endTime: 23, lane: 2 });
  expect(new Set(pasted.notes.map((note: any) => note.id)).size).toBe(5);
  await page.locator('#undo').click(); await expect(page.locator('#note-count')).toHaveText('2 NOTES');
  await page.locator('#undo').click(); expect(await saved(page)).toEqual(before);
  await page.locator('#redo').click(); await page.locator('#redo').click(); expect(await saved(page)).toEqual(pasted);
  await page.reload(); await expect(page.locator('#note-count')).toHaveText('5 NOTES');
  await expect(page.locator('#paste-range')).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reverse range dragging selects across all lanes without moving any notes', async ({ page }, info) => {
  await imported(page); const before = await saved(page); await page.locator('#follow').uncheck();
  await page.locator('#view-start').fill('10'); await page.locator('#view-start').blur();
  if (info.project.name === 'mobile-touch') await page.locator('#timeline-mode').selectOption('range');
  await page.locator('#timeline').scrollIntoViewIfNeeded();
  const box = (await page.locator('#timeline').boundingBox())!, x = box.x + 42, end = x + (box.width - 42) / 2, y = box.y + 60;
  if (info.project.name === 'mobile-touch') {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: end, y, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 150, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.keyboard.down('Shift'); await page.mouse.move(end, y); await page.mouse.down();
    await page.mouse.move(x, y + 150, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Shift');
  }
  await expect(page.locator('#range-start')).toHaveValue('10.000'); await expect(page.locator('#range-end')).toHaveValue('12.000');
  await expect(page.locator('#range-status')).toContainText('3個'); expect(await saved(page)).toEqual(before);
  await page.locator('#copy-range').click(); await expect(page.locator('#clipboard-status')).toContainText('3個をコピー済み');
});

test('range keyboard shortcuts support undo and leave number-field editing alone', async ({ page }) => {
  await imported(page); await choose(page); await page.locator('#timeline').focus(); await page.keyboard.press('Control+c');
  await page.locator('#paste-time').fill('20'); await page.locator('#timeline').focus(); await page.keyboard.press('Control+v');
  await expect(page.locator('#note-count')).toHaveText('8 NOTES');
  await page.keyboard.press('Delete'); await expect(page.locator('#note-count')).toHaveText('5 NOTES');
  await page.keyboard.press('Control+z'); await expect(page.locator('#note-count')).toHaveText('8 NOTES');
  await page.locator('#range-start').focus(); await page.keyboard.press('Backspace'); await expect(page.locator('#note-count')).toHaveText('8 NOTES');
  await page.locator('#timeline').focus(); await page.keyboard.press('Escape'); await expect(page.locator('#clear-range')).toBeDisabled();
});
