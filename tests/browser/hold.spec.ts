import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { api, seekPlay } from './mock-video';
const chart = {
  videoId: 'pJDfWpZ7CI4', title: 'SUPER MOMMY GIRLS', bpm: 120, startTime: 12, beatOrigin: 12,
  notes: [{ id: 1, time: 12, endTime: 12.9, sourceTime: 12, sourceEndTime: 12.9, lane: 0, type: 'hold' }],
};
async function loadEditor(page: Page, data: unknown = chart) {
  await page.goto('/editor.html'); await expect(page.locator('#record-toggle')).toBeEnabled();
  await page.locator('#import-chart').setInputFiles({ name: 'chart.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.locator('#editor-notice')).toContainText('読み込みました');
}
async function loadGame(page: Page, data: unknown = chart) {
  await page.goto('/');
  await page.evaluate(data => localStorage.setItem('hey-rhythm-custom-chart-v1', JSON.stringify(data)), data);
  await page.goto('/?chart=custom'); await expect(page.locator('#restart')).toBeEnabled();
  await page.locator('#game-canvas').click();
}
async function saved(page: Page) {
  await expect(page.locator('#save-status')).toContainText('保存しました');
  return page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-editor-v1')!));
}
async function touchesFor(page: Page, lanes: number[]) {
  await page.locator('.lane-buttons').scrollIntoViewIfNeeded();
  return Promise.all(lanes.map(async lane => { const box = (await page.locator(`.lane-button[data-lane="${lane}"]`).boundingBox())!; return { id: lane + 1, x: box.x + box.width / 2, y: box.y + box.height / 2 }; }));
}
test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: api }));
});

test('captures hold press/release timestamps, quantizes endpoints, and cancels interrupted capture', async ({ page }) => {
  await page.goto('/editor.html'); await expect(page.locator('#record-toggle')).toBeEnabled();
  await page.locator('#record-type').selectOption('hold'); await page.locator('#record-toggle').click();
  await seekPlay(page, 12.08); await page.keyboard.down('s');
  await expect(page.locator('#note-count')).toHaveText('0 NOTES'); await expect(page.locator('#record-status')).toContainText('長押し記録中');
  await page.waitForTimeout(220); await page.keyboard.up('s');
  await expect(page.locator('#note-count')).toHaveText('1 NOTES');
  let data = await saved(page); const note = data.notes[0];
  expect(note.type).toBe('hold'); expect(note.sourceTime).toBe(note.time); expect(note.sourceEndTime).toBe(note.endTime);
  expect(note.endTime - note.time).toBeGreaterThan(0.2);
  await page.locator('#quantize').click(); data = await saved(page);
  expect(data.notes[0].sourceTime).toBe(note.time); expect(data.notes[0].sourceEndTime).toBe(note.endTime);
  expect((data.notes[0].time - 12) / (60 / 140 / 4)).toBeCloseTo(Math.round((data.notes[0].time - 12) / (60 / 140 / 4)), 6);
  await page.locator('#record-toggle').click(); await page.keyboard.down('d');
  await page.evaluate(() => (window as any).testVideo.setState(2));
  await expect(page.locator('#editor-notice')).toContainText('破棄'); await page.keyboard.up('d');
  await expect(page.locator('#note-count')).toHaveText('1 NOTES');
  await seekPlay(page, 14); await page.keyboard.down('f'); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.keyboard.up('f');
  await expect(page.locator('#note-count')).toHaveText('1 NOTES'); await expect(page.locator('#editor-notice')).toContainText('キャンセル');
});

test('edits a hold tail, adds a chord, converts note types, undoes and round-trips JSON', async ({ page }) => {
  await loadEditor(page); await page.locator('#follow').uncheck(); await page.locator('#view-start').fill('12'); await page.locator('#view-start').blur(); await page.locator('#view-span').selectOption('2');
  await page.locator('#timeline').scrollIntoViewIfNeeded();
  const box = (await page.locator('#timeline').boundingBox())!, width = box.width - 42;
  const y = box.y + 30 + (box.height - 30) / 12;
  await page.mouse.move(box.x + 42 + 0.9 / 2 * width, y); await page.mouse.down(); await page.mouse.move(box.x + 42 + 1.15 / 2 * width, y, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('#note-end')).toHaveValue('13.125');
  await page.locator('#note-end').fill('13.5'); await page.locator('#note-end').blur();
  await page.locator('#chord-lane').selectOption('3'); await page.locator('#add-chord').click();
  await expect(page.locator('#note-count')).toHaveText('2 NOTES'); let data = await saved(page);
  expect(data.notes.map((n: any) => n.time)).toEqual([12, 12]); expect(data.notes.map((n: any) => n.endTime)).toEqual([13.5, 13.5]);
  await page.locator('#undo').click(); await expect(page.locator('#note-count')).toHaveText('1 NOTES');
  await page.locator('#redo').click(); await expect(page.locator('#note-count')).toHaveText('2 NOTES');
  await page.locator('#note-type').selectOption('tap'); await expect(page.locator('#note-end-label')).toBeHidden();
  await page.locator('#undo').click(); await expect(page.locator('#note-type')).toHaveValue('hold');
  data = await saved(page); await loadEditor(page, data); expect(await saved(page)).toEqual(data);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('two touch holds are judged independently when one finger lifts early', async ({ page }) => {
  await loadGame(page, { ...chart, notes: [chart.notes[0], { ...chart.notes[0], id: 2, lane: 3 }] });
  const touches = await touchesFor(page, [0, 3]), session = await page.context().newCDPSession(page);
  await seekPlay(page, 12); await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('HOLD'); await expect(page.locator('#judgement-3 .judgement-label')).toHaveText('HOLD');
  await expect(page.locator('#score')).toHaveText('000000');
  await expect(page.locator('.lane-button.holding')).toHaveCount(2);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [touches[0]] });
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('MISS'); await expect(page.locator('.lane-button.pressed')).toHaveCount(1);
  await expect(page.locator('.lane-button.holding')).toHaveCount(1);
  await expect(page.locator('#judgement-3 .judgement-label')).toHaveText(/PERFECT|GREAT/); await expect(page.locator('#combo')).toHaveText('1');
  const score = Number(await page.locator('#score').textContent()); expect(score).toBeGreaterThanOrEqual(700); expect(score).toBeLessThanOrEqual(1000);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await expect(page.locator('#score')).toHaveText(String(score).padStart(6, '0'));
  await expect(page.locator('#result')).toBeVisible();
});

test('releasing the keyboard keeps a hold active while another input source holds its lane', async ({ page }) => {
  await loadGame(page); const touches = await touchesFor(page, [0]), session = await page.context().newCDPSession(page);
  await seekPlay(page, 12); await page.keyboard.down('s');
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
  await page.keyboard.up('s'); await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('HOLD');
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText(/PERFECT|GREAT/);
  await expect(page.locator('#combo')).toHaveText('1');
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
});

test('holds suspend judgement while paused, allow regripping, and fail on focus loss during play', async ({ page }) => {
  await loadGame(page); await seekPlay(page, 12); await page.keyboard.down('s');
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('HOLD');
  await page.evaluate(() => (window as any).testVideo.setState(2)); await page.keyboard.up('s'); await page.waitForTimeout(120);
  await expect(page.locator('#score')).toHaveText('000000'); await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('HOLD');
  await page.keyboard.down('s'); await page.evaluate(() => (window as any).testVideo.playVideo());
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText(/PERFECT|GREAT/); await page.keyboard.up('s');
  await page.locator('#restart').click(); await expect(page.locator('#control-status')).toContainText('開始まで'); await seekPlay(page, 12); await page.keyboard.down('s');
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('HOLD');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('MISS'); await expect(page.locator('#score')).toHaveText('000000'); await page.keyboard.up('s');
});

test('focused lane buttons support holding Space and seeking skips active holds', async ({ page }) => {
  await loadGame(page); await page.locator('.lane-button[data-lane="0"]').focus(); await seekPlay(page, 12); await page.keyboard.down('Space');
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('HOLD');
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText(/PERFECT|GREAT/); await page.keyboard.up('Space');
  await page.locator('#restart').click(); await expect(page.locator('#control-status')).toContainText('開始まで'); await seekPlay(page, 12); await page.keyboard.down('s');
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('HOLD');
  await page.evaluate(() => (window as any).testVideo.seekTo(20));
  await expect(page.locator('#game-notice')).toContainText('前方シーク'); await expect(page.locator('#score')).toHaveText('000000');
  await page.keyboard.up('s');
});

test('dense sixteenth heads keep visible gaps, sizing is adjustable and shared with the game', async ({ page }) => {
  const notes = Array.from({ length: 24 }, (_, i) => ({ id: i + 1, type: 'tap', time: 12 + i / 8, lane: 0 }));
  await loadEditor(page, { ...chart, notes }); await page.locator('#follow').uncheck(); await page.locator('#view-start').fill('12'); await page.locator('#view-start').blur(); await page.locator('#view-span').selectOption('8');
  const widths = () => page.locator('#timeline').evaluate(async (canvas: HTMLCanvasElement) => {
    const original = CanvasRenderingContext2D.prototype.fillRect, widths: number[] = [];
    CanvasRenderingContext2D.prototype.fillRect = function (...args) { if (this.canvas === canvas && args[3] === 22) widths.push(args[2]); return original.apply(this, args); };
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    CanvasRenderingContext2D.prototype.fillRect = original;
    return { widths, pixelGap: (canvas.getBoundingClientRect().width - 42) / 8 / 8 };
  });
  const dense = await widths(); expect(dense.widths.length).toBeGreaterThan(0); expect(Math.max(...dense.widths)).toBeLessThan(dense.pixelGap * 0.8);
  await page.locator('#view-span').selectOption('2'); const before = await widths();
  await page.locator('#editor-note-size').fill('50'); await page.locator('#editor-note-size').dispatchEvent('input'); const after = await widths();
  expect(Math.max(...after.widths)).toBeLessThan(Math.max(...before.widths));
  await page.locator('#try-game').click(); await expect(page.locator('#restart')).toBeEnabled();
  await page.locator('#settings-toggle').click(); await expect(page.locator('#note-size')).toHaveValue('50');
  await page.locator('#note-size').fill('120'); await page.locator('#note-size').dispatchEvent('input');
  await page.reload(); await page.locator('#settings-toggle').click(); await expect(page.locator('#note-size')).toHaveValue('120');
});
