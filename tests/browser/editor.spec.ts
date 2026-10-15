import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { api, seekPlay } from './mock-video';

const chart = {
  videoId: 'pJDfWpZ7CI4', title: 'SUPER MOMMY GIRLS', bpm: 120, startTime: 10.149, beatOrigin: 10.07,
  notes: [{ id: 1, time: 10.149, lane: 0, type: 'tap', sourceTime: 10.149 }, { id: 2, time: 10.204, lane: 3, type: 'tap', sourceTime: 10.204 }],
};
async function importChart(page: Page, data: unknown = chart) {
  await page.locator('#import-chart').setInputFiles({ name: 'chart.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.locator('#note-count')).toHaveText(`${(data as typeof chart).notes.length} NOTES`);
}
async function saved(page: Page) {
  await expect(page.locator('#save-status')).toContainText('保存しました');
  return page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-editor-v1')!));
}
test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: api }));
  await page.goto('/editor.html');
  await expect(page.locator('#record-toggle')).toBeEnabled();
});

test('records actual key/touch timestamps only while armed and playing, without repeats', async ({ page }) => {
  await expect(page.locator('#division')).toHaveValue('4');
  await page.locator('#record-toggle').click();
  await page.keyboard.press('s'); await expect(page.locator('#note-count')).toHaveText('0 NOTES');
  await seekPlay(page, 12.123);
  await page.keyboard.down('s'); await page.keyboard.down('s'); await page.keyboard.up('s');
  await expect(page.locator('#note-count')).toHaveText('1 NOTES');
  const note = (await saved(page)).notes[0];
  expect(note.time).toBeGreaterThanOrEqual(12.123); expect(note.time).toBeLessThan(12.5); expect(note.sourceTime).toBe(note.time);
  // Two physical contacts arrive together and must create separate lane notes.
  await page.locator('#record-pads').scrollIntoViewIfNeeded();
  const touches = await Promise.all([1, 4].map(async lane => { const box = (await page.locator(`.lane-button[data-lane="${lane}"]`).boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2, id: lane + 1 }; }));
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
  await expect(page.locator('.lane-button.pressed')).toHaveCount(2);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#note-count')).toHaveText('3 NOTES');
  await page.evaluate(() => (window as any).testVideo.setState(2));
  await page.keyboard.press('f');
  await page.evaluate(() => (window as any).testVideo.setState(3)); await page.keyboard.press('j');
  await expect(page.locator('#note-count')).toHaveText('3 NOTES');
  await page.locator('#record-toggle').click(); await seekPlay(page, 14); await page.keyboard.press('k');
  await expect(page.locator('#note-count')).toHaveText('3 NOTES');
});

test('quantizes with beat phase, adjusts one note, undoes, saves and exports original timing', async ({ page }) => {
  await importChart(page); await page.locator('#quantize').click();
  await expect(page.locator('#save-status')).toContainText('保存しました');
  let data = await saved(page); expect(data.notes.map((n: any) => n.time)).toEqual([10.195, 10.195]);
  expect(data.notes.map((n: any) => n.sourceTime)).toEqual([10.149, 10.204]);
  await page.getByText('表示範囲のノーツ一覧（最大100個）', { exact: true }).click(); await page.getByRole('button', { name: 'ノーツ1を選択', exact: true }).click();
  await page.locator('#nudge-plus').click(); await expect(page.locator('#note-time')).toHaveValue('10.205');
  await page.locator('#undo').click(); await expect(page.locator('#note-time')).toHaveValue('10.195');
  await page.locator('#redo').click(); await expect(page.locator('#note-time')).toHaveValue('10.205');
  await page.locator('#note-lane').selectOption('2');
  await page.locator('#note-time').fill('10.222'); await page.locator('#note-time').blur();
  data = await saved(page); expect(data.notes.find((n: any) => n.id === 1)).toMatchObject({ time: 10.222, lane: 2, sourceTime: 10.149 });
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export-chart').click();
  const download = await downloadPromise; expect(download.suggestedFilename()).toBe('hey-rhythm-chart.json');
  const stream = await download.createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(data);
  await page.reload(); await expect(page.locator('#note-count')).toHaveText('2 NOTES');
  await expect(page.locator('#beat-origin')).toHaveValue('10.07');
  expect(Number(await page.locator('#view-start').inputValue())).toBeGreaterThan(9);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-editor-v1')!).notes.find((n: any) => n.id === 1).time)).toBe(10.222);
});

test('drags a timeline note across lanes as one undoable edit, with optional snap', async ({ page }) => {
  await importChart(page); await page.locator('#follow').uncheck();
  await page.locator('#view-start').fill('10'); await page.locator('#view-start').blur();
  await page.locator('#view-span').selectOption('2'); await page.locator('#drag-snap').uncheck();
  await page.locator('#timeline').scrollIntoViewIfNeeded();
  const box = (await page.locator('#timeline').boundingBox())!;
  const x = box.x + 42 + 0.149 / 2 * (box.width - 42), y = box.y + 30 + (box.height - 30) / 12;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + (box.width - 42) * 0.15, y + (box.height - 30) / 6 * 2, { steps: 4 }); await page.mouse.up();
  await expect(page.locator('#note-lane')).toHaveValue('2');
  expect(Number(await page.locator('#note-time').inputValue())).toBeCloseTo(10.449, 2);
  let data = await saved(page); expect(data.notes.find((n: any) => n.id === 1).sourceTime).toBe(10.149);
  await page.locator('#undo').click(); data = await saved(page);
  expect(data.notes.find((n: any) => n.id === 1)).toMatchObject({ time: 10.149, lane: 0 });
  await page.locator('#drag-snap').check();
  await page.locator('#timeline').scrollIntoViewIfNeeded();
  const current = (await page.locator('#timeline').boundingBox())!;
  const startX = current.x + 42 + 0.149 / 2 * (current.width - 42), startY = current.y + 30 + (current.height - 30) / 12;
  await page.mouse.move(startX, startY); await page.mouse.down(); await page.mouse.move(startX + (current.width - 42) * 0.15, startY, { steps: 4 }); await page.mouse.up();
  await expect(page.locator('#note-time')).toHaveValue('10.445');
});

test('plays the edited chart and keeps it on restart, then switches back to practice', async ({ page }) => {
  await importChart(page);
  await page.locator('#try-game').click(); await expect(page).toHaveURL(/\?chart=custom$/);
  await expect(page.locator('#chart-source')).toHaveValue('custom');
  await expect(page.locator('#chart-info')).toContainText('EDITOR CHART · 120 BPM · 10.1秒〜 · 2 NOTES');
  await expect(page.locator('#restart')).toBeEnabled();
  await page.locator('#game-canvas').click(); await seekPlay(page, 10.149); await page.keyboard.press('s');
  expect(Number(await page.locator('#score').textContent())).toBeGreaterThanOrEqual(700);
  await page.locator('#restart').click(); await expect(page.locator('#chart-info')).toContainText('2 NOTES');
  expect(await page.evaluate(() => (window as any).testVideo.getCurrentTime())).toBeLessThan(8);
  await page.locator('#settings-toggle').click(); await expect(page.locator('#bpm')).toBeDisabled();
  await page.locator('#chart-source').selectOption('test'); await expect(page.locator('#chart-info')).toContainText('TEST CHART');
  await expect(page.locator('#bpm')).toBeEnabled();
});

test('invalid import preserves the document; clearing and importing can be undone', async ({ page }) => {
  await importChart(page); const before = await saved(page);
  await page.locator('#import-chart').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...chart, notes: [{ ...chart.notes[0], lane: 8 }] })) });
  await expect(page.locator('#editor-notice')).toContainText('レーン');
  expect(await saved(page)).toEqual(before);
  await page.locator('#new-chart').click(); await expect(page.locator('#note-count')).toHaveText('0 NOTES');
  await page.locator('#undo').click(); await expect(page.locator('#note-count')).toHaveText('2 NOTES');
  await importChart(page, { ...chart, bpm: 150 }); await page.locator('#undo').click(); await expect(page.locator('#editor-bpm')).toHaveValue('120');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('video errors stop capture while editing works, and failed storage keeps JSON export available', async ({ page }) => {
  await importChart(page);
  await page.evaluate(() => (window as any).testVideo.options.events.onError({ target: (window as any).testVideo, data: 153 }));
  await expect(page.locator('#record-toggle')).toBeDisabled(); await expect(page.locator('#player-error')).toContainText('153');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
  await page.locator('#quantize').click(); await expect(page.locator('#save-status')).toContainText('保存できません');
  await page.locator('#try-game').click(); await expect(page.locator('#editor-notice')).toContainText('試遊用の譜面を保存できません');
  await expect(page).toHaveURL(/editor.html$/);
  const download = page.waitForEvent('download'); await page.locator('#export-chart').click(); expect((await download).suggestedFilename()).toBe('hey-rhythm-chart.json');
});

test('adds and deletes manual notes, seeks from the ruler, and auditions each passing note once', async ({ page }) => {
  await importChart(page);
  await page.evaluate(() => { const video = (window as any).testVideo; video.setState(2); video.seekTo(5.678); });
  await page.locator('#add-lane').selectOption('5'); await page.locator('#add-note').click();
  await expect(page.locator('#note-count')).toHaveText('3 NOTES'); await expect(page.locator('#note-time')).toHaveValue('5.678');
  let data = await saved(page); expect(data.notes.find((n: any) => n.id === 3)).toMatchObject({ time: 5.678, lane: 5 });
  expect(data.notes.find((n: any) => n.id === 3).sourceTime).toBeUndefined();
  await page.locator('#note-time').fill('-1'); await page.locator('#note-time').blur();
  await expect(page.locator('#editor-notice')).toContainText('秒数'); await expect(page.locator('#note-time')).toHaveValue('5.678');
  await page.locator('#delete-note').click(); await expect(page.locator('#note-count')).toHaveText('2 NOTES');
  await page.locator('#undo').click(); await expect(page.locator('#note-count')).toHaveText('3 NOTES');
  await page.locator('#follow').uncheck(); await page.locator('#view-start').fill('9'); await page.locator('#view-start').blur();
  await page.locator('#view-span').selectOption('2'); await page.locator('#timeline').scrollIntoViewIfNeeded();
  const box = (await page.locator('#timeline').boundingBox())!;
  await page.mouse.click(box.x + 42 + (box.width - 42) / 4, box.y + 12);
  await expect.poll(() => page.evaluate(() => (window as any).testVideo.getCurrentTime())).toBeCloseTo(9.5, 1);
  await page.evaluate(() => {
    (window as any).auditionSounds = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) { (window as any).auditionSounds++; return start.apply(this, args); };
  });
  await page.locator('#audition').check();
  await seekPlay(page, 9.9);
  await expect.poll(() => page.evaluate(() => (window as any).auditionSounds)).toBe(3); // Enable click + two passing notes.
  await page.evaluate(() => (window as any).testVideo.setState(2));
  await page.waitForTimeout(150); expect(await page.evaluate(() => (window as any).auditionSounds)).toBe(3);
  data = await saved(page); expect(data.notes).toHaveLength(3);
});
