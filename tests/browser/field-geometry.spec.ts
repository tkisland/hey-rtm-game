import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { api } from './mock-video';

async function bands(page: Page, selector: string) {
  return page.locator(selector).evaluate(async (element: HTMLCanvasElement) => {
    const fill = CanvasRenderingContext2D.prototype.fillRect, move = CanvasRenderingContext2D.prototype.moveTo;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    let zones: {x: number; y: number; width: number; height: number}[] = [], line = 0;
    CanvasRenderingContext2D.prototype.clearRect = function(...args) { if (this.canvas === element) { zones = []; line = 0; } return clear.apply(this, args); };
    CanvasRenderingContext2D.prototype.fillRect = function(...args) {
      if (this.canvas === element && (Math.abs(this.globalAlpha - 0.08) < 0.001 || Math.abs(this.globalAlpha - 0.12) < 0.001) && args[0] < element.getBoundingClientRect().width / 6) zones.push({ x: args[0], y: args[1], width: args[2], height: args[3] });
      return fill.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.moveTo = function(...args) { if (this.canvas === element && this.lineWidth === 2 && args[0] === 0) line = args[1]; return move.apply(this, args); };
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return { zones, line, height: element.getBoundingClientRect().height };
    } finally { CanvasRenderingContext2D.prototype.fillRect = fill; CanvasRenderingContext2D.prototype.moveTo = move; CanvasRenderingContext2D.prototype.clearRect = clear; }
  });
}
async function range(page: Page, id: string, value: string) { await page.locator(`#${id}`).fill(value); await page.locator(`#${id}`).dispatchEvent('input'); }
test.beforeEach(async ({ page }) => { await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ body: api })); await page.goto('/'); });

test('actual rendered note centers at each band edge receive the matching engine judgement', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer.ts');
    const { GameEngine } = await import('/src/engine.ts');
    const { compensateInput } = await import('/src/timing.ts');
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;width:360px;height:350px;opacity:0;pointer-events:none';
    document.body.append(canvas); const renderer = new Renderer(canvas);
    const ctx = canvas.getContext('2d')!, fill = ctx.fillRect.bind(ctx), round = ctx.roundRect.bind(ctx);
    let zones: {y: number; height: number; width: number}[] = [], heads: {x: number;y: number; width: number; height: number}[] = [];
    ctx.fillRect = function(...args) { if ((Math.abs(this.globalAlpha - 0.08) < 0.001 || Math.abs(this.globalAlpha - 0.12) < 0.001) && args[0] < 60) zones.push({y: args[1], height: args[3], width: args[2]}); return fill(...args); };
    ctx.roundRect = function(...args) { heads.push({x: args[0], y: args[1], width: args[2], height: args[3]}); return round(...args); };
    const results = [];
    try {
      for (const offset of [-300, 0, 300]) for (const [error, zone, expected] of [[-0.16,0,'GOOD'],[-0.1,1,'GREAT'],[-0.05,2,'PERFECT'],[0.05,2,'PERFECT'],[0.1,1,'GREAT'],[0.16,0,'GOOD']] as const) {
        const engine = new GameEngine({videoId:'pJDfWpZ7CI4', title:'test', bpm:120, startTime:12, notes:[{id:1,lane:0,type:'tap',time:12}]});
        zones = []; heads = [];
        const time = 12 + offset / 1000 + error;
        renderer.draw(engine.notes, time, 2, 0, 150, 120, offset);
        const head = heads[0], band = zones[zone], center = head.y + head.height / 2;
        const pixel = ctx.getImageData(Math.floor((head.x + head.width / 2) * devicePixelRatio), Math.floor(center * devicePixelRatio), 1, 1).data;
        results.push({ center, boundary: error < 0 ? band.y : band.y + band.height, width: head.width, bandWidth: band.width,
          expected, judgement: engine.input(0, compensateInput(time, offset))?.judgement, visible: pixel[0] > 150 });
      }
    } finally { renderer.destroy(); canvas.remove(); }
    return results;
  });
  expect(result).toHaveLength(18);
  for (const sample of result) { expect(sample.center).toBeCloseTo(sample.boundary, 6); expect(sample.width).toBe(sample.bandWidth); expect(sample.judgement).toBe(sample.expected); expect(sample.visible).toBe(true); }
});

test('game bands follow speed and compensation, independently of note thickness', async ({ page }) => {
  await page.locator('#settings-toggle').click(); await range(page, 'input-offset', '0');
  const normal = await bands(page, '#game-canvas'); expect(normal.zones).toHaveLength(3);
  for (const band of normal.zones) expect(band.y + band.height / 2).toBeCloseTo(normal.line);
  expect(normal.zones[0].height / normal.zones[2].height).toBeCloseTo(160 / 50);
  await range(page, 'input-offset', '300');
  const late = await bands(page, '#game-canvas');
  expect(late.zones[0].height).toBeCloseTo(normal.zones[0].height);
  expect(late.line - normal.line).toBeCloseTo(normal.zones[0].height * 300 / 320);
  expect(late.zones[0].y + late.zones[0].height).toBeLessThanOrEqual(late.height - 8 + 0.01);
  await range(page, 'note-size', '50'); const thin = await bands(page, '#game-canvas'); expect(thin.zones).toEqual(late.zones);
  await range(page, 'travel', '1'); const fast = await bands(page, '#game-canvas');
  await range(page, 'travel', '4'); const slow = await bands(page, '#game-canvas');
  expect(fast.zones[0].height).toBeGreaterThan(slow.zones[0].height);
});

test('editor automatic preview keeps zero-compensation bands despite the saved input setting', async ({ page }) => {
  await page.locator('#settings-toggle').click(); await range(page, 'input-offset', '300');
  await page.goto('/editor.html');
  const preview = await bands(page, '#preview-canvas'); expect(preview.zones).toHaveLength(3);
  await page.locator('.timing-settings summary').click(); await range(page, 'editor-input-offset', '-300');
  const changed = await bands(page, '#preview-canvas'); expect(changed).toEqual(preview);
  const speed = preview.line / 2;
  expect(preview.zones[0].height).toBeCloseTo(0.32 * speed);
  expect(preview.zones[2].height).toBeCloseTo(0.1 * speed);
});
