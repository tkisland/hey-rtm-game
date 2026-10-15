import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { api } from './mock-video';
async function bands(page: Page, selector: string) {
  return page.locator(selector).evaluate(async (element: HTMLCanvasElement) => {
    const proto = CanvasRenderingContext2D.prototype, originals = { fill: proto.fill, move: proto.moveTo, line: proto.lineTo, clear: proto.clearRect };
    let zones: {
      x: number;
      y: number;
    }[][] = [], path: {
      x: number;
      y: number;
    }[] = [];
    proto.clearRect = function (...args) { if (this.canvas === element)
      zones = []; return originals.clear.apply(this, args); };
    proto.moveTo = function (...args) { if (this.canvas === element)
      path = [{ x: args[0], y: args[1] }]; return originals.move.apply(this, args); };
    proto.lineTo = function (...args) { if (this.canvas === element)
      path.push({ x: args[0], y: args[1] }); return originals.line.apply(this, args); };
    proto.fill = function (...args: any[]) {
      if (this.canvas === element && (Math.abs(this.globalAlpha - 0.08) < .001 || Math.abs(this.globalAlpha - 0.12) < .001))
        zones.push([...path]);
      return (originals.fill as any).apply(this, args);
    };
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return zones;
    }
    finally {
      proto.fill = originals.fill;
      proto.moveTo = originals.move;
      proto.lineTo = originals.line;
      proto.clearRect = originals.clear;
    }
  });
}
async function range(page: Page, id: string, value: string) { await page.locator(`#${id}`).fill(value); await page.locator(`#${id}`).dispatchEvent('input'); }
test.beforeEach(async ({ page }) => { await page.route('https://www.youtube.com/iframe_api', r => r.fulfill({ body: api })); await page.goto('/game.html?chart=test'); });
test('actual rendered centers at each perspective-band edge match the engine judgement', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const { Renderer } = await import('/src/renderer.ts'), { GameEngine } = await import('/src/engine.ts'), { compensateInput } = await import('/src/timing.ts');
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;width:370px;height:480px;opacity:0;pointer-events:none';
    document.body.append(canvas);
    const renderer = new Renderer(canvas), ctx = canvas.getContext('2d')!;
    const original = { fill: ctx.fill.bind(ctx), move: ctx.moveTo.bind(ctx), line: ctx.lineTo.bind(ctx), round: ctx.roundRect.bind(ctx) };
    let zones: {
      x: number;
      y: number;
    }[][] = [], path: {
      x: number;
      y: number;
    }[] = [], heads: {
      x: number;
      y: number;
      w: number;
      h: number;
    }[] = [];
    ctx.moveTo = function (x, y) { path = [{ x, y }]; return original.move(x, y); };
    ctx.lineTo = function (x, y) { path.push({ x, y }); return original.line(x, y); };
    ctx.fill = function (...args: any[]) { if (Math.abs(this.globalAlpha - .08) < .001 || Math.abs(this.globalAlpha - .12) < .001)
      zones.push([...path]); return (original.fill as any)(...args); };
    ctx.roundRect = function (...args) { heads.push({ x: args[0], y: args[1], w: args[2], h: args[3] }); return original.round(...args); };
    const results = [];
    try {
      for (const lane of [0, 2, 5])
        for (const offset of [-300, 0, 300])
          for (const [error, zone, expected] of [[-.16, 0, 'GOOD'], [-.1, 1, 'GREAT'], [-.05, 2, 'PERFECT'], [.05, 2, 'PERFECT'], [.1, 1, 'GREAT'], [.16, 0, 'GOOD']] as const) {
            const engine = new GameEngine({ videoId: 'pJDfWpZ7CI4', title: 'test', bpm: 120, startTime: 12, notes: [{ id: 1, lane, type: 'tap', time: 12 }] });
            zones = [];
            heads = [];
            const time = 12 + offset / 1000 + error;
            renderer.draw(engine.notes, time, 2, 0, 150, 120, offset);
            const head = heads[0], band = zones[lane * 3 + zone], edge = error < 0 ? [band[0], band[1]] : [band[2], band[3]];
            const cx = head.x + head.w / 2, cy = head.y + head.h / 2;
            const pixel = ctx.getImageData(Math.floor(cx * devicePixelRatio), Math.floor(cy * devicePixelRatio), 1, 1).data;
            results.push({ cx, cy, x: (edge[0].x + edge[1].x) / 2, y: edge[0].y, width: head.w, bandWidth: Math.abs(edge[1].x - edge[0].x), judgement: engine.input(lane, compensateInput(time, offset))?.judgement, expected, visible: Math.max(...pixel.slice(0, 3)) > 150 });
          }
    }
    finally {
      renderer.destroy();
      canvas.remove();
    }
    return results;
  });
  expect(results).toHaveLength(54);
  for (const r of results) {
    expect(r.cx).toBeCloseTo(r.x, 6);
    expect(r.cy).toBeCloseTo(r.y, 6);
    expect(r.width).toBeCloseTo(r.bandWidth, 6);
    expect(r.judgement).toBe(r.expected);
    expect(r.visible).toBe(true);
  }
});
test('targets and timing bands stay fixed when changing correction or thickness, and speed changes the band', async ({ page }) => {
  await page.locator('#settings-toggle').click();
  await range(page, 'input-offset', '0');
  const normal = await bands(page, '#game-canvas');
  expect(normal).toHaveLength(18);
  const targets = () => page.locator('.lane-button').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
  const before = await targets();
  await range(page, 'input-offset', '300');
  expect(await bands(page, '#game-canvas')).toEqual(normal);
  expect(await targets()).toEqual(before);
  await range(page, 'note-size', '50');
  expect(await bands(page, '#game-canvas')).toEqual(normal);
  await range(page, 'travel', '1');
  const fast = await bands(page, '#game-canvas');
  await range(page, 'travel', '4');
  const slow = await bands(page, '#game-canvas');
  expect(fast[0][2].y - fast[0][0].y).toBeGreaterThan(slow[0][2].y - slow[0][0].y);
  expect(await targets()).toEqual(before);
});
test('editor preview uses the same V targets and zero-correction bands', async ({ page }) => {
  await page.locator('#settings-toggle').click();
  await range(page, 'input-offset', '300');
  await page.goto('/editor.html');
  const before = await bands(page, '#preview-canvas');
  expect(before).toHaveLength(18);
  await page.locator('.timing-settings summary').click();
  await range(page, 'editor-input-offset', '-300');
  expect(await bands(page, '#preview-canvas')).toEqual(before);
  const geometry = await page.locator('#preview-lanes').evaluate(node => [...node.children].map(child => { const r = child.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  expect(geometry[0].y).toBeLessThan(geometry[1].y);
  expect(geometry[1].y).toBeLessThan(geometry[2].y);
  expect(geometry[2].y).toBe(geometry[3].y);
});
