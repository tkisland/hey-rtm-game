import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { api, seekPlay } from './mock-video';

const chart = {
  videoId: 'pJDfWpZ7CI4', title: 'test', bpm: 120, startTime: 12,
  notes: [0, 5].map(lane => ({ id: lane + 1, lane, type: 'hold', time: 12, endTime: 16 })),
};
type Effects = { sparks: { x: number; y: number }[]; glows: { x: number; y: number }[] };
const effects = (page: Page, id = 'game-canvas'): Promise<Effects> => page.evaluate(id => (window as any).holdEffects[id], id);
async function sparks(page: Page, active: boolean, id = 'game-canvas') {
  await expect.poll(async () => (await effects(page, id)).sparks.length > 0).toBe(active);
}
async function quiet(page: Page, id = 'game-canvas') {
  await expect.poll(() => effects(page, id)).toEqual({ sparks: [], glows: [] });
}

test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ body: api }));
  await page.addInitScript(chart => {
    if (!localStorage.getItem('hey-rhythm-custom-chart-v1')) localStorage.setItem('hey-rhythm-custom-chart-v1', JSON.stringify(chart));
    localStorage.setItem('hey-rhythm-settings-v1', JSON.stringify({ sound: false }));
    (window as any).holdEffects = {};
    const proto = CanvasRenderingContext2D.prototype;
    const clear = proto.clearRect, move = proto.moveTo, ellipse = proto.ellipse;
    proto.clearRect = function(...args) {
      (window as any).holdEffects[this.canvas.id] = { sparks: [], glows: [] };
      return clear.apply(this, args);
    };
    proto.moveTo = function(...args) {
      if (this.globalCompositeOperation === 'lighter') (window as any).holdEffects[this.canvas.id]?.sparks.push({ x: args[0], y: args[1] });
      return move.apply(this, args);
    };
    proto.ellipse = function(...args) {
      if (this.globalCompositeOperation === 'lighter') (window as any).holdEffects[this.canvas.id]?.glows.push({ x: args[0], y: args[1] });
      return ellipse.apply(this, args);
    };
  }, chart);
  await page.goto('/game.html?chart=custom'); await expect(page.locator('#restart')).toBeEnabled();
});

test('both touch holds keep emitting after the initial burst; lifting one stops only that lane', async ({ page }) => {
  await page.locator('.lane-buttons').scrollIntoViewIfNeeded();
  const touches = await Promise.all([0, 5].map(async lane => {
    const r = (await page.locator(`.lane-button[data-lane="${lane}"]`).boundingBox())!;
    return { id: lane + 1, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }));
  const session = await page.context().newCDPSession(page);
  await seekPlay(page, 12);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
  await expect(page.locator('.lane-button.holding')).toHaveCount(2);
  // The one-shot success burst has ended; these must be continuous hold particles.
  await page.waitForTimeout(550); await sparks(page, true);
  const before = await effects(page);
  expect(before.glows).toHaveLength(2);
  const center = await page.locator('#game-canvas').evaluate(canvas => canvas.getBoundingClientRect().width / 2);
  expect(before.sparks.some(point => point.x < center)).toBe(true);
  expect(before.sparks.some(point => point.x > center)).toBe(true);
  await page.waitForTimeout(90);
  expect((await effects(page)).sparks).not.toEqual(before.sparks);
  await expect(page.locator('#score')).toHaveText('0');
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [touches[0]] });
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('MISS');
  await expect.poll(async () => (await effects(page)).glows.length).toBe(1);
  expect((await effects(page)).sparks.every(point => point.x > center)).toBe(true);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#judgement-5 .judgement-label')).toHaveText('MISS'); await quiet(page);
});

test('pause and buffering stop particles; resume restores them and seek or restart clears them', async ({ page }) => {
  await seekPlay(page, 12); await page.keyboard.down('s'); await page.waitForTimeout(550); await sparks(page, true);
  for (const state of [2, 3]) {
    await page.evaluate(state => (window as any).testVideo.setState(state), state); await quiet(page);
    if (state === 2) { await page.keyboard.up('s'); await page.keyboard.down('s'); }
    await page.evaluate(() => (window as any).testVideo.playVideo()); await sparks(page, true);
  }
  await page.evaluate(() => (window as any).testVideo.seekTo(20));
  await expect(page.locator('#game-notice')).toContainText('前方シーク'); await quiet(page);
  await page.locator('#restart').click(); await quiet(page); await page.keyboard.up('s');
});

test('missing the endpoint ends continuous sparks even while the key stays down; empty holds emit none', async ({ page }) => {
  await page.evaluate(chart => localStorage.setItem('hey-rhythm-custom-chart-v1', JSON.stringify({
    ...chart, notes: [{ ...chart.notes[0], endTime: 13.2 }],
  })), chart);
  await page.reload(); await expect(page.locator('#restart')).toBeEnabled();
  await seekPlay(page, 12); await page.keyboard.down('s'); await page.waitForTimeout(550); await sparks(page, true);
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('MISS');
  await page.waitForTimeout(450); await quiet(page);
  await expect(page.locator('.lane-button.pressed')).toHaveCount(1);
  await page.keyboard.up('s'); await page.keyboard.down('d'); await quiet(page); await page.keyboard.up('d');
});

test('reduced motion keeps a steady hold glow without flying sparks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seekPlay(page, 12); await page.keyboard.down('s'); await page.waitForTimeout(550);
  expect((await effects(page)).glows).toHaveLength(1); await sparks(page, false);
  await page.waitForTimeout(100); expect((await effects(page)).glows).toHaveLength(1);
  await page.keyboard.up('s'); await quiet(page);
});

test('editor playback shows hold particles and stops them on pause and stop', async ({ page }) => {
  await page.goto('/editor.html'); await expect(page.locator('#record-toggle')).toBeEnabled();
  await page.locator('#import-chart').setInputFiles({ name: 'hold.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(chart)) });
  await page.locator('#preview-sound').uncheck(); await page.locator('#preview-first').click();
  await expect(page.locator('#preview-lanes [data-lane="0"] output')).toHaveText('HOLD');
  await page.waitForTimeout(550); await sparks(page, true, 'preview-canvas');
  await page.locator('#preview-pause').click(); await quiet(page, 'preview-canvas');
  await page.locator('#preview-play').click(); await sparks(page, true, 'preview-canvas');
  await page.locator('#preview-stop').click(); await quiet(page, 'preview-canvas');
});
