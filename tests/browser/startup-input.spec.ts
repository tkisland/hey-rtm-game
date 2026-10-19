import { test, expect } from '@playwright/test';
import { api } from './mock-video';

test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ body: api }));
  await page.goto('/game.html'); await expect(page.locator('#play-start')).toBeEnabled();
});

test('video starts at zero, resume keeps its position and restart returns to zero without moving notes', async ({ page }) => {
  expect(await page.evaluate(() => (window as any).testVideo.getCurrentTime())).toBe(0);
  await expect(page.locator('#chart-info')).toContainText('7.65秒〜 · 510 NOTES');
  await expect(page.getByRole('button',{name:'ゲームスタート',exact:true})).toBeEnabled();
  await expect(page.locator('#stage-hint')).toContainText('「ゲームスタート」を押してライブ開始！');
  await page.locator('#play-start').click();
  expect(await page.evaluate(() => (window as any).testVideo.getCurrentTime())).toBeLessThan(.5);
  await expect(page.locator('#score')).toHaveText('0');
  await page.evaluate(() => { const v = (window as any).testVideo; v.pauseVideo(); v.seekTo(3.4); });
  await expect(page.getByRole('button',{name:'ゲーム再開',exact:true})).toBeEnabled();
  await expect(page.locator('#stage-hint')).toContainText('「ゲーム再開」を押してライブ再開！');
  await page.locator('#play-start').click();
  const resumed = await page.evaluate(() => (window as any).testVideo.getCurrentTime()); expect(resumed).toBeGreaterThanOrEqual(3.4); expect(resumed).toBeLessThan(3.9);
  await page.locator('#restart').click();
  expect(await page.evaluate(() => (window as any).testVideo.getCurrentTime())).toBeLessThan(.5);
  await expect(page.locator('#chart-info')).toContainText('7.65秒〜 · 510 NOTES');
});

test('the start button and all six pads stay reachable on small and landscape screens', async ({ page }, info) => {
  const sizes = [[320, 480], [320, 568], [390, 844], [640, 360]];
  if (info.project.name === 'mobile-touch') sizes.push([844, 390]);
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height }); await page.evaluate(() => scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => {
      return ['#play-start', ...Array.from({ length: 6 }, (_, lane) => `.lane-button[data-lane="${lane}"]`)].every(selector => {
        const node = document.querySelector(selector)!, r = node.getBoundingClientRect();
        const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return r.top >= 0 && r.bottom <= innerHeight && (target === node || node.contains(target));
      });
    })).toBe(true);
    expect(await page.locator('#play-start').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  }
  await page.locator('#play-start').click();
  expect(await page.evaluate(() => (window as any).testVideo.getPlayerState())).toBe(1);
});

test('the first eight real key taps reuse audio and start without extra queuing or six-buffer input work', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).startupStarts = []; (window as any).startupBuffers = 0; (window as any).inputStamp = 0;
    document.addEventListener('keydown', () => { (window as any).inputStamp = performance.now(); }, true);
    const create = AudioContext.prototype.createBuffer;
    AudioContext.prototype.createBuffer = function(...args) { (window as any).startupBuffers++; return create.apply(this, args); };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) {
      (window as any).startupStarts.push({ requested: (window as any).inputStamp, actual: performance.now(), when: args[0], now: this.context.currentTime, buffers: (window as any).startupBuffers });
      return start.apply(this, args);
    };
  });
  await page.locator('#play-start').click();
  expect(await page.evaluate(() => (window as any).startupStarts.length)).toBe(0);
  for (const key of ['s', 'd', 'f', 'j', 'k', 'l', 's', 'd']) await page.keyboard.press(key);
  await expect.poll(() => page.evaluate(() => (window as any).startupStarts.length)).toBe(8);
  const events = await page.evaluate(() => (window as any).startupStarts as { requested: number; actual: number; when: number; now: number; buffers: number }[]);
  expect(events.map(event => event.buffers)).toEqual([1, 2, 3, 4, 5, 6, 6, 6]);
  for (const event of events) { expect(event.actual - event.requested).toBeLessThan(80); expect(event.when - event.now).toBeLessThan(.003); }
});

test('a suspended output cannot replay the first eight taps as a late burst', async ({ page }) => {
  await page.locator('#play-start').click();
  const result = await page.evaluate(async () => {
    const { TapSound } = await import('/src/sound.ts');
    const errors: string[] = [], sound = new TapSound(() => errors.push('unavailable'));
    await sound.unlock(); const context = (sound as any).context as AudioContext; await context.suspend();
    const resume = AudioContext.prototype.resume, start = AudioBufferSourceNode.prototype.start;
    const pending: (() => void)[] = []; let count = 0;
    AudioContext.prototype.resume = function() { return new Promise<void>((resolve, reject) => { pending.push(() => { void resume.call(this).then(resolve, reject); }); }); };
    AudioBufferSourceNode.prototype.start = function(...args) { if (this.context === context) count++; return start.apply(this, args); };
    try {
      for (let i = 0; i < 8; i++) sound.play(i % 6);
      await new Promise(resolve => setTimeout(resolve, 180));
      pending.forEach(release => release()); await new Promise(resolve => setTimeout(resolve, 40));
      const stale = count; sound.play(2); return { stale, fresh: count, errors };
    } finally { AudioContext.prototype.resume = resume; AudioBufferSourceNode.prototype.start = start; sound.destroy(); }
  });
  expect(result).toEqual({ stale: 0, fresh: 1, errors: [] });
});

test('explicit sound delay remains relative to the input rather than being added after audio resumes', async ({ page }) => {
  await page.locator('#play-start').click();
  const result = await page.evaluate(async () => {
    const { TapSound } = await import('/src/sound.ts');
    const sound = new TapSound(() => {}); sound.delay = 250; await sound.unlock();
    const context = (sound as any).context as AudioContext; await context.suspend();
    const resume = AudioContext.prototype.resume, start = AudioBufferSourceNode.prototype.start;
    let release!: () => void; let timing: { elapsed: number; remaining: number } | null = null; let requested = 0;
    AudioContext.prototype.resume = function() { return new Promise<void>((resolve, reject) => { release = () => { void resume.call(this).then(resolve, reject); }; }); };
    AudioBufferSourceNode.prototype.start = function(...args) { if (this.context === context) timing = { elapsed: performance.now() - requested, remaining: (args[0]! - this.context.currentTime) * 1000 }; return start.apply(this, args); };
    try {
      requested = performance.now(); sound.play(0); await new Promise(resolve => setTimeout(resolve, 120)); release();
      await new Promise(resolve => setTimeout(resolve, 40)); return timing;
    } finally { AudioContext.prototype.resume = resume; AudioBufferSourceNode.prototype.start = start; sound.destroy(); }
  });
  expect(result).not.toBeNull(); expect(result!.elapsed + result!.remaining).toBeCloseTo(250, -1);
});

test('rapid native touch taps never double the sound, zoom or move the control surface', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-touch', 'Native mobile zoom regression');
  await page.locator('#play-start').click();
  const button = page.locator('.lane-button[data-lane="5"]'), box = (await button.boundingBox())!;
  const before = await page.evaluate(() => ({ scale: visualViewport!.scale, scroll: scrollY, top: document.getElementById('game-canvas')!.getBoundingClientRect().top }));
  await page.evaluate(() => {
    (window as any).touchEnds = []; (window as any).rapidStarts = 0;
    document.addEventListener('touchend', event => { (window as any).touchEnds.push(event.defaultPrevented); });
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) { (window as any).rapidStarts++; return start.apply(this, args); };
  });
  const session = await page.context().newCDPSession(page);
  for (let i = 0; i < 12; i++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const after = await page.evaluate(() => ({ scale: visualViewport!.scale, scroll: scrollY, top: document.getElementById('game-canvas')!.getBoundingClientRect().top, starts: (window as any).rapidStarts, prevented: (window as any).touchEnds }));
  expect(after.scale).toBe(before.scale); expect(after.scroll).toBe(before.scroll); expect(after.top).toBeCloseTo(before.top, 3);
  expect(after.starts).toBe(12); expect(after.prevented).toEqual(Array(12).fill(true));
  await expect(page.locator('.lane-button.pressed')).toHaveCount(0);
  expect(await page.locator('body').evaluate(node => getComputedStyle(node).touchAction)).toBe('manipulation');
});
