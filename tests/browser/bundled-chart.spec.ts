import { test, expect } from '@playwright/test';
import { api, seekPlay, waitForVideoTime } from './mock-video';
import { readFileSync } from 'node:fs';
const smg = JSON.parse(readFileSync(new URL('../../src/charts/smg005.json', import.meta.url), 'utf8'));

const draft = { videoId: 'pJDfWpZ7CI4', title: 'my draft', bpm: 120, startTime: 10, beatOrigin: 10, notes: [{ id: 1, time: 10, lane: 0, type: 'tap' }] };
test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ body: api }));
});
test('the primary menu entry plays SMG005 at 7.65s, including its first yellow note', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('[data-song="super-mommy-girls"] .song-meta')).toContainText('SMG005 · 166 → 192 BPM · 510 NOTES');
  await expect(page.locator('[data-song="super-mommy-girls"] .song-play')).toHaveText('収録譜面で遊ぶ'); await page.locator('[data-song="super-mommy-girls"] .song-play').click();
  await expect(page.locator('#restart')).toBeEnabled(); await expect(page.locator('#chart-source')).toHaveValue('bundled');
  await expect(page.locator('#chart-info')).toContainText('BUNDLED CHART · 166 → 192 BPM · 7.65秒〜 · 510 NOTES');
  expect(await page.evaluate(() => (window as any).testVideo.getCurrentTime())).toBe(0);
  await seekPlay(page, 7.65); await page.keyboard.press('l');
  await expect(page.locator('#judgement-5 .judgement-label')).toHaveText(/PERFECT|GREAT|GOOD/);
  expect(Number((await page.locator('#score').textContent())!.replaceAll(',', ''))).toBeGreaterThan(0);
  await page.locator('#restart').click(); await expect(page.locator('#score')).toHaveText('0');
  await expect(page.locator('#chart-info')).toContainText('510 NOTES');
});
test('the shipped two-lane hold scores only after both endpoint releases', async ({ page }) => {
  await page.goto('/game.html'); await expect(page.locator('#restart')).toBeEnabled();
  await seekPlay(page, 74.761398469);
  await page.keyboard.down('s'); await page.keyboard.down('l');
  await expect(page.locator('.lane-button.holding')).toHaveCount(2);
  const tails = smg.notes.filter((note: any) => note.type === 'hold' && Math.abs(note.time - 74.761398469) < .001).sort((a: any,b: any) => a.endTime - b.endTime);
  for (const note of tails) { await waitForVideoTime(page, note.endTime); await page.keyboard.up(note.lane === 0 ? 's' : 'l'); }
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText(/PERFECT|GREAT|GOOD/);
  await expect(page.locator('#judgement-5 .judgement-label')).toHaveText(/PERFECT|GREAT|GOOD/);
  await expect(page.locator('.lane-button.holding')).toHaveCount(0);
  const score = Number((await page.locator('#score').textContent())!.replaceAll(',', '')); expect(score).toBeGreaterThanOrEqual(600); expect(score).toBeLessThanOrEqual(2000);
  await page.keyboard.up('s'); await page.keyboard.up('l'); await expect(page.locator('#score')).toHaveText(score.toLocaleString('ja-JP'));
});
test('bundled, practice and saved charts coexist without changing existing drafts or settings', async ({ page }) => {
  await page.addInitScript(data => {
    localStorage.setItem('hey-rhythm-editor-v1', JSON.stringify(data)); localStorage.setItem('hey-rhythm-custom-chart-v1', JSON.stringify(data));
    localStorage.setItem('hey-rhythm-settings-v1', JSON.stringify({ bpm: 150, startTime: 14, sound: false }));
  }, draft);
  await page.goto('/game.html'); await expect(page.locator('#restart')).toBeEnabled();
  await expect(page.locator('#chart-source')).toHaveValue('bundled'); await page.locator('#settings-toggle').click();
  await expect(page.locator('#bpm')).toBeDisabled(); await expect(page.locator('#start-time')).toBeDisabled();
  await page.locator('#chart-source').selectOption('test'); await expect(page.locator('#chart-info')).toContainText('TEST CHART · 150 BPM · 14.0秒');
  await page.reload(); await expect(page.locator('#chart-source')).toHaveValue('test');
  await page.locator('#settings-toggle').click(); await page.locator('#chart-source').selectOption('custom');
  await expect(page.locator('#chart-info')).toContainText('EDITOR CHART · 120 BPM · 10.0秒〜 · 1 NOTES');
  await page.locator('#chart-source').selectOption('bundled'); await expect(page.locator('#chart-info')).toContainText('510 NOTES');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-editor-v1')!))).toEqual(draft);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-custom-chart-v1')!))).toEqual(draft);
});
test('the editor loads a bundled copy explicitly, preserves undo and exports the tempo changes', async ({ page }) => {
  await page.addInitScript(data => { if (!localStorage.getItem('hey-rhythm-editor-v1')) localStorage.setItem('hey-rhythm-editor-v1', JSON.stringify(data)); }, draft);
  await page.goto('/editor.html'); await expect(page.locator('#record-toggle')).toBeEnabled();
  await expect(page.locator('#note-count')).toHaveText('1 NOTES');
  await page.locator('#load-bundled-chart').click(); await expect(page.locator('#note-count')).toHaveText('510 NOTES');
  await expect(page.locator('#tempo-info')).toContainText('166 → 192 BPM');
  await page.locator('#undo').click(); await expect(page.locator('#note-count')).toHaveText('1 NOTES');
  await page.locator('#redo').click(); await expect(page.locator('#note-count')).toHaveText('510 NOTES');
  await expect(page.locator('#save-status')).toContainText('保存しました');
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-editor-v1')!));
  expect(data).toEqual(smg); expect(data.notes.filter((n: any) => n.type === 'hold')).toHaveLength(21);
  const downloadEvent = page.waitForEvent('download'); await page.locator('#export-chart').click(); const download = await downloadEvent;
  const stream = await download.createReadStream(); const chunks = []; for await (const chunk of stream!) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(smg);
  await page.locator('#try-game').click(); await expect(page.locator('#restart')).toBeEnabled(); await expect(page.locator('#chart-info')).toContainText('EDITOR CHART · 166 → 192 BPM');
});
test('timeline range snap follows the new tempo without resetting beat phase at its MIDI event', async ({ page }) => {
  await page.goto('/editor.html'); await expect(page.locator('#record-toggle')).toBeEnabled(); await page.locator('#load-bundled-chart').click();
  await page.locator('#follow').uncheck(); await page.locator('#view-start').fill('18'); await page.locator('#view-start').dispatchEvent('change');
  await page.locator('#timeline-mode').selectOption('range'); await page.locator('#drag-snap').check();
  const canvas = page.locator('#timeline'); await canvas.scrollIntoViewIfNeeded(); const box = (await canvas.boundingBox())!;
  const x = (time: number) => box.x + 42 + (time - 18) / 4 * (box.width - 42);
  await page.mouse.move(x(19.47), box.y + 70); await page.mouse.down(); await page.mouse.move(x(20.01), box.y + 120, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('#range-start')).toHaveValue('19.449'); await expect(page.locator('#range-end')).toHaveValue('19.996');
});
