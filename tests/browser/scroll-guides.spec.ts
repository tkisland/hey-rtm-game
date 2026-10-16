import { test, expect } from '@playwright/test';
import { api } from './mock-video';

// Beat 31 follows a tempo event at fractional beat 30.36875, not a new downbeat.
const chart = {
  videoId: 'pJDfWpZ7CI4', title: 'SUPER MOMMY GIRLS', bpm: 166.000359667,
  startTime: 7.65, beatOrigin: 7.65, tempoChanges: [{ time: 18.626632844, bpm: 192 }],
  notes: Array.from({ length: 6 }, (_, lane) => ({ id: lane + 1, lane, type: 'tap', time: 18.823898469 })),
};
test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ body: api }));
});

test('rendered notes in all six lanes move the same distance per frame throughout the approach', async ({ page }) => {
  await page.goto('/game.html?chart=test'); await expect(page.locator('#restart')).toBeEnabled();
  const frames = await page.locator('#game-canvas').evaluate(async (canvas: HTMLCanvasElement) => {
    const { Renderer } = await import('/src/renderer.ts'), { GameEngine } = await import('/src/engine.ts');
    const renderer = new Renderer(canvas), ctx = canvas.getContext('2d')!, original = ctx.roundRect.bind(ctx);
    const engine = new GameEngine({ videoId: 'pJDfWpZ7CI4', title: 'test', bpm: 120, startTime: 12,
      notes: Array.from({ length: 6 }, (_, lane) => ({ id: lane + 1, lane, type: 'tap', time: 12 })) });
    let heads: { x: number; y: number; width: number }[] = [];
    ctx.roundRect = function(...args) { heads.push({ x: args[0] + args[2] / 2, y: args[1] + args[3] / 2, width: args[2] }); return original(...args); };
    try {
      return [10, 10.4, 10.8, 11.2, 11.6, 12].map(time => {
        heads = []; renderer.draw(engine.notes, time, 2, 0); return heads;
      });
    } finally { ctx.roundRect = original; renderer.destroy(); }
  });
  frames.forEach(frame => expect(frame).toHaveLength(6));
  frames.forEach(frame => frame.forEach(head => expect(head.y).toBeCloseTo(frame[0].y, 7)));
  const distance = frames[1][0].y - frames[0][0].y;
  expect(distance).toBeGreaterThan(0);
  for (let i = 1; i < frames.length; i++) for (let lane = 0; lane < 6; lane++) {
    expect(frames[i][lane].y - frames[i - 1][lane].y).toBeCloseTo(distance, 7);
    expect(frames[i][lane].y - frames[i][2].y).toBeCloseTo(frames[0][lane].y - frames[0][2].y, 7);
    const widthRatio = frames[0][lane].width / frames.at(-1)![lane].width;
    expect(widthRatio).toBeGreaterThanOrEqual(.5); expect(widthRatio).toBeLessThanOrEqual(.7);
  }
});

for (const editor of [false, true]) test(`${editor ? 'editor preview' : 'game'} horizontal beat guides move with notes through a tempo change and respect the appropriate clock`, async ({ page }) => {
  await page.addInitScript(chart => {
    localStorage.setItem('hey-rhythm-custom-chart-v1', JSON.stringify(chart));
    localStorage.setItem('hey-rhythm-editor-v1', JSON.stringify(chart));
    localStorage.setItem('hey-rhythm-settings-v1', JSON.stringify({ sound: false, inputOffset: 300, offset: 200 }));
    (window as any).scrollFrames = {};
    const proto = CanvasRenderingContext2D.prototype;
    const clear = proto.clearRect, round = proto.roundRect, move = proto.moveTo, curve = proto.bezierCurveTo, stroke = proto.stroke;
    let paths = new WeakMap<HTMLCanvasElement, { x: number; y: number }[]>();
    proto.clearRect = function(...args) {
      (window as any).scrollFrames[this.canvas.id] = { heads: [], guides: [] };
      return clear.apply(this, args);
    };
    proto.roundRect = function(...args) {
      (window as any).scrollFrames[this.canvas.id]?.heads.push({ x: args[0] + args[2] / 2, y: args[1] + args[3] / 2 });
      return round.apply(this, args);
    };
    proto.moveTo = function(x, y) { paths.set(this.canvas, [{ x, y }]); return move.call(this, x, y); };
    proto.bezierCurveTo = function(...args) { paths.get(this.canvas)?.push({ x: args[4], y: args[5] }); return curve.apply(this, args); };
    proto.stroke = function(...args: any[]) {
      const points = paths.get(this.canvas);
      if (points?.length === 8) (window as any).scrollFrames[this.canvas.id]?.guides.push([...points]);
      return (stroke as any).apply(this, args);
    };
  }, chart);
  await page.goto(editor ? '/editor.html' : '/game.html?chart=custom');
  await expect(page.locator(editor ? '#record-toggle' : '#restart')).toBeEnabled();
  // Both snapshots remain before the note. The game applies +200ms chart and +300ms input
  // correction, whereas the automatic editor preview intentionally uses the raw video clock.
  const snapshots: { heads: { x: number; y: number }[]; guides: { x: number; y: number }[][] }[] = [];
  for (const time of [18.1, 18.7]) {
    await page.evaluate(time => {
      const video = (window as any).testVideo; video.setState(2); video.liveClock = false; video.seekTo(time);
    }, time);
    await page.waitForTimeout(80);
    const snapshot = await page.evaluate(id => (window as any).scrollFrames[id], editor ? 'preview-canvas' : 'game-canvas');
    expect(snapshot.heads).toHaveLength(6); expect(snapshot.guides.length).toBeGreaterThan(2);
    snapshot.guides.forEach((guide: { x: number; y: number }[]) => guide.forEach(point => expect(point.y).toBeCloseTo(guide[0].y, 7)));
    // A quarter-note guide must pass through all six simultaneous heads. Resetting beat
    // phase at 18.6266s, using a fixed BPM, or omitting either compensation breaks this.
    const matching = snapshot.guides.find((guide: { x: number; y: number }[]) => snapshot.heads.every((head: { x: number; y: number }, lane: number) =>
      Math.abs(head.x - guide[lane + 1].x) < .001 && Math.abs(head.y - guide[lane + 1].y) < .001));
    expect(matching).toBeDefined(); snapshots.push(snapshot);
  }
  const dy = snapshots[1].heads[0].y - snapshots[0].heads[0].y;
  expect(dy).toBeGreaterThan(0);
  snapshots[1].heads.forEach((head, lane) => expect(head.y - snapshots[0].heads[lane].y).toBeCloseTo(dy, 6));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-custom-chart-v1')!))).toEqual(chart);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-editor-v1')!))).toEqual(chart);
});
