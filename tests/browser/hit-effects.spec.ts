import { test, expect } from '@playwright/test';
import { api, seekPlay } from './mock-video';

test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ body: api }));
  await page.addInitScript(() => {
    localStorage.setItem('hey-rhythm-custom-chart-v1', JSON.stringify({
      videoId: 'pJDfWpZ7CI4', title: 'test', bpm: 120, startTime: 12,
      notes: [0, 5].map(lane => ({ id: lane + 1, lane, type: 'tap', time: 12 })),
    }));
    localStorage.setItem('hey-rhythm-settings-v1', JSON.stringify({ sound: false }));
    (window as any).hitRings = []; (window as any).sparkLines = 0;
    const ellipse = CanvasRenderingContext2D.prototype.ellipse, move = CanvasRenderingContext2D.prototype.moveTo;
    CanvasRenderingContext2D.prototype.ellipse = function(...args) {
      if (this.canvas.id === 'game-canvas' && this.globalCompositeOperation === 'lighter') {
        (window as any).hitRings.push({ x: args[0], y: args[1], radius: args[2], alpha: this.globalAlpha });
      }
      return ellipse.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.moveTo = function(...args) {
      if (this.canvas.id === 'game-canvas' && this.globalCompositeOperation === 'lighter') (window as any).sparkLines++;
      return move.apply(this, args);
    };
  });
  await page.goto('/game.html?chart=custom'); await expect(page.locator('#restart')).toBeEnabled();
});

for (const [kind, error] of [['PERFECT', 0], ['GREAT', 0.065], ['GOOD', 0.12]] as const) {
  test(`${kind} chord emits effects from visible receptors above the thumb pads, then fades`, async ({ page }) => {
    await page.locator('.stage').scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const targets = await page.locator('.lane-receptor').evaluateAll(buttons => {
      const canvas = document.getElementById('game-canvas')!.getBoundingClientRect();
      return buttons.map(button => { const r = button.getBoundingClientRect(); return { x: r.x + r.width / 2 - canvas.x, y: r.y + r.height / 2 - canvas.y }; });
    });
    await seekPlay(page, 12 + error);
    await page.keyboard.down('s'); await page.keyboard.down('l');
    await page.keyboard.up('s'); await page.keyboard.up('l');
    await expect(page.locator('#judgement-0 .judgement-label')).toHaveText(kind);
    await expect(page.locator('#judgement-5 .judgement-label')).toHaveText(kind);
    await expect.poll(() => page.evaluate(targets => [0, 5].every(lane =>
      (window as any).hitRings.some((ring: { x: number }) => Math.abs(ring.x - targets[lane].x) < 0.1)), targets)).toBe(true);
    const rings = await page.evaluate(() => (window as any).hitRings as { x: number; y: number; radius: number; alpha: number }[]);
    for (const lane of [0, 5]) {
      const ring = rings.find(ring => Math.abs(ring.x - targets[lane].x) < 0.1)!;
      expect(ring).toBeTruthy(); expect(ring.y).toBeCloseTo(targets[lane].y, 1); expect(ring.alpha).toBeGreaterThan(0);
    }
    expect(await page.evaluate(() => (window as any).sparkLines)).toBeGreaterThan(0);
    const after = await page.locator('.lane-receptor').evaluateAll(buttons => {
      const canvas = document.getElementById('game-canvas')!.getBoundingClientRect();
      return buttons.map(button => { const r = button.getBoundingClientRect(); return { x: r.x + r.width / 2 - canvas.x, y: r.y + r.height / 2 - canvas.y }; });
    });
    expect(after).toEqual(targets);
    await page.waitForTimeout(450);
    await page.evaluate(() => { (window as any).hitRings = []; });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await page.evaluate(() => (window as any).hitRings)).toEqual([]);
  });
}

test('empty taps and MISS do not emit success effects', async ({ page }) => {
  await seekPlay(page, 12); await page.keyboard.press('f');
  await page.evaluate(() => (window as any).testVideo.seekTo(12.2));
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('MISS');
  expect(await page.evaluate(() => (window as any).hitRings)).toEqual([]);
});

test('reduced motion uses a static glow with no flying sparks; restart clears it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seekPlay(page, 12); await page.keyboard.press('s');
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('PERFECT');
  await expect.poll(() => page.evaluate(() => (window as any).hitRings.length)).toBeGreaterThan(0);
  const rings = await page.evaluate(() => (window as any).hitRings as { radius: number }[]);
  expect(new Set(rings.map(ring => ring.radius)).size).toBe(1);
  expect(await page.evaluate(() => (window as any).sparkLines)).toBe(0);
  await page.evaluate(() => { document.getElementById('restart')!.click(); (window as any).hitRings = []; });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(() => (window as any).hitRings)).toEqual([]);
});
