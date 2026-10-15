import { test, expect } from '@playwright/test';
import { api } from './mock-video';

const chart = {
  videoId: 'pJDfWpZ7CI4', title: 'SUPER MOMMY GIRLS', bpm: 120, startTime: 12,
  notes: Array.from({ length: 6 }, (_, lane) => ({ id: lane + 1, lane, type: 'tap', time: 12 })),
};
test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ body: api }));
  await page.goto('/game.html');
  await expect(page.locator('#restart')).toBeEnabled();
});

test('all six real button centers are the rendered PERFECT position, including input compensation', async ({ page }) => {
  for (const offset of [-300, 0, 300]) {
    await page.evaluate(({ chart, offset }) => {
      localStorage.setItem('hey-rhythm-custom-chart-v1', JSON.stringify(chart));
      localStorage.setItem('hey-rhythm-settings-v1', JSON.stringify({ inputOffset: offset, sound: false }));
    }, { chart, offset });
    await page.goto('/game.html?chart=custom'); await expect(page.locator('#restart')).toBeEnabled();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.evaluate(offset => {
      const video = (window as any).testVideo;
      video.seekTo(12 + offset / 1000); video.setState(2);
    }, offset);
    const positions = await page.locator('#game-canvas').evaluate(async (canvas: HTMLCanvasElement) => {
      const proto = CanvasRenderingContext2D.prototype, original = proto.roundRect, clear = proto.clearRect;
      let heads: { x: number; y: number }[] = [];
      proto.clearRect = function(...args) { if (this.canvas === canvas) heads = []; return clear.apply(this, args); };
      proto.roundRect = function(...args) {
        if (this.canvas === canvas) heads.push({ x: args[0] + args[2] / 2, y: args[1] + args[3] / 2 });
        return original.apply(this, args);
      };
      try {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const field = canvas.getBoundingClientRect();
        const targets = [...document.querySelectorAll('.lane-button')].map(button => {
          const r = button.getBoundingClientRect(); return { x: r.x + r.width / 2 - field.x, y: r.y + r.height / 2 - field.y };
        });
        return { heads, targets };
      } finally { proto.roundRect = original; proto.clearRect = clear; }
    });
    expect(positions.heads).toHaveLength(6);
    positions.heads.forEach((head, lane) => {
      expect(head.x).toBeCloseTo(positions.targets[lane].x, 1);
      expect(head.y).toBeCloseTo(positions.targets[lane].y, 1);
    });
    await page.evaluate(() => (window as any).testVideo.playVideo());
    await page.keyboard.press('s');
    await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('PERFECT');
    await expect(page.locator('#score')).toHaveText('001000');
  }
});

test('outer held chord heads stay at the V targets with a straight link across empty lanes', async ({ page }) => {
  const result = await page.locator('#game-canvas').evaluate(async (canvas: HTMLCanvasElement) => {
    const { Renderer } = await import('/src/renderer.ts'), { GameEngine } = await import('/src/engine.ts');
    const engine = new GameEngine({ videoId: 'pJDfWpZ7CI4', title: 'test', bpm: 120, startTime: 12,
      notes: [0, 5].map(lane => ({ id: lane + 1, lane, type: 'hold', time: 12, endTime: 14 })) });
    for (const lane of [0, 5]) engine.input(lane, 12);
    const renderer = new Renderer(canvas), ctx = canvas.getContext('2d')!;
    const original = { round: ctx.roundRect.bind(ctx), fill: ctx.fillRect.bind(ctx), dash: ctx.setLineDash.bind(ctx), move: ctx.moveTo.bind(ctx), line: ctx.lineTo.bind(ctx), curve: ctx.bezierCurveTo.bind(ctx), stroke: ctx.stroke.bind(ctx) };
    const heads: { x: number; y: number; width: number }[] = [], tails: { y: number; width: number }[] = [];
    let dashed = false, path: { x: number; y: number }[] = [], link: { x: number; y: number }[] = [];
    ctx.roundRect = function(...args) { heads.push({ x: args[0] + args[2] / 2, y: args[1] + args[3] / 2, width: args[2] }); return original.round(...args); };
    ctx.fillRect = function(...args) { if (args[3] > 1 && args[3] < 12 && args[2] > 5) tails.push({ y: args[1] + args[3] / 2, width: args[2] }); return original.fill(...args); };
    ctx.setLineDash = segments => { dashed = segments.length > 0; original.dash(segments); };
    ctx.moveTo = (x, y) => { path = [{ x, y }]; original.move(x, y); };
    ctx.lineTo = (x, y) => { path.push({ x, y }); original.line(x, y); };
    ctx.bezierCurveTo = (a, b, c, d, x, y) => { path.push({ x: a, y: b }, { x: c, y: d }, { x, y }); original.curve(a, b, c, d, x, y); };
    ctx.stroke = function(...args: any[]) { if (dashed) link = [...path]; return (original.stroke as any)(...args); };
    try {
      renderer.draw(engine.notes, 13.3, 2, 0, 100, 120, 300);
      const r = canvas.getBoundingClientRect();
      const targets = [...document.querySelectorAll('.lane-button')].map(button => { const b = button.getBoundingClientRect(); return { x: b.x + b.width / 2 - r.x, y: b.y + b.height / 2 - r.y }; });
      return { heads, tails, link, targets };
    } finally {
      ctx.roundRect = original.round; ctx.fillRect = original.fill; ctx.setLineDash = original.dash;
      ctx.moveTo = original.move; ctx.lineTo = original.line; ctx.bezierCurveTo = original.curve; ctx.stroke = original.stroke; renderer.destroy();
    }
  });
  expect(result.heads).toHaveLength(2); expect(result.tails).toHaveLength(2); expect(result.link).toHaveLength(4);
  // Both control points lie on the horizontal connection, with no detour through empty lanes.
  result.link.forEach(point => expect(point.y).toBeCloseTo(result.heads[0].y));
  result.heads.forEach((head, index) => {
    const lane = index === 0 ? 0 : 5;
    expect(head.x).toBeCloseTo(result.targets[lane].x, 1); expect(head.y).toBeCloseTo(result.targets[lane].y, 1);
    const endpoint = result.link[index === 0 ? 0 : 3];
    expect(endpoint.x).toBeCloseTo(head.x); expect(endpoint.y).toBeCloseTo(head.y);
    expect(result.tails[index].width).toBeLessThan(head.width); expect(result.tails[index].y).toBeLessThan(head.y);
  });
});

test('real rendered note bars widen and approach smoothly along the perspective lane', async ({ page }) => {
  const samples = await page.locator('#game-canvas').evaluate(async (canvas: HTMLCanvasElement) => {
    const { Renderer } = await import('/src/renderer.ts'), { GameEngine } = await import('/src/engine.ts');
    const renderer = new Renderer(canvas), ctx = canvas.getContext('2d')!, original = ctx.roundRect.bind(ctx);
    const samples: { x: number; y: number; width: number }[] = [];
    ctx.roundRect = function(...args) { samples.push({ x: args[0] + args[2] / 2, y: args[1] + args[3] / 2, width: args[2] }); return original(...args); };
    try {
      const engine = new GameEngine({ videoId: 'pJDfWpZ7CI4', title: 'test', bpm: 120, startTime: 12, notes: [{ id: 1, lane: 0, time: 12, type: 'tap' }] });
      for (const p of [0.2, 0.4, 0.6, 0.8, 1]) renderer.draw(engine.notes, 12 + (p - 1) * 2, 2, 0);
      return samples;
    } finally { ctx.roundRect = original; renderer.destroy(); }
  });
  expect(samples).toHaveLength(5);
  for (let i = 1; i < samples.length; i++) {
    expect(samples[i].width).toBeGreaterThan(samples[i - 1].width);
    expect(samples[i].y).toBeGreaterThan(samples[i - 1].y);
    expect(samples[i].x).toBeLessThan(samples[i - 1].x);
  }
});
