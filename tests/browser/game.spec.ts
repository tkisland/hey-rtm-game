import { test, expect } from '@playwright/test';
import { api, seekPlay } from './mock-video';

test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: api }));
  await page.goto('/game.html?chart=test');
  await expect(page.locator('#restart')).toBeEnabled();
});

test('keyboard timing, repeat protection, paused/buffering input, seek and restart', async ({ page }) => {
  await page.locator('iframe').evaluate((frame: HTMLIFrameElement) => frame.contentWindow?.focus());
  await page.locator('#game-canvas').click();
  await expect(page.locator('#game-canvas')).toBeFocused();
  await seekPlay(page, 12);
  await page.keyboard.down('s');
  const initialScore = await page.locator('#score').textContent();
  expect(Number(initialScore!.replaceAll(',', ''))).toBeGreaterThanOrEqual(700);
  await page.keyboard.down('s');
  await expect(page.locator('#score')).toHaveText(initialScore!);
  await page.keyboard.up('s');
  await expect(page.locator('#combo')).toHaveText('1');
  await page.evaluate(() => (window as any).testVideo.setState(2));
  const score = await page.locator('#score').textContent();
  await page.waitForTimeout(350);
  await page.keyboard.press('d');
  await expect(page.locator('#score')).toHaveText(score!);
  await page.evaluate(() => (window as any).testVideo.setState(3));
  await page.keyboard.press('f');
  await expect(page.locator('#score')).toHaveText(score!);
  await seekPlay(page, 20);
  await expect(page.locator('#game-notice')).toContainText('前方シーク');
  await expect(page.locator('#score')).toHaveText(score!);
  await seekPlay(page, 10);
  await expect(page.locator('#score')).toHaveText('0');
  await page.locator('#restart').click();
  await expect(page.locator('#combo')).toHaveText('0');
  expect(await page.evaluate(() => (window as any).testVideo.getCurrentTime())).toBeLessThan(10);
});

test('independent simultaneous pointer inputs, settings persistence and high DPI canvas', async ({ page }) => {
  // Keep the authored beat fixed while native touch events cross the browser compositor.
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  // At beat 4, the deterministic chart has simultaneous notes in lanes 3 and 0.
  await page.locator('.lane-buttons').scrollIntoViewIfNeeded();
  const touches = await Promise.all([0, 3].map(async lane => {
    const box = (await page.locator(`.lane-button[data-lane="${lane}"]`).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, id: lane + 1 };
  }));
  await page.evaluate(() => {
    (window as any).touchSounds = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) { (window as any).touchSounds++; return start.apply(this, args); };
  });
  const session = await page.context().newCDPSession(page);
  await seekPlay(page, 12 + 4 * 60 / 140);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
  await expect(page.locator('.lane-button.pressed')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => (window as any).touchSounds)).toBe(2);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.lane-button.pressed')).toHaveCount(0);
  expect(Number((await page.locator('#score').textContent())!.replaceAll(',', ''))).toBeGreaterThanOrEqual(1400);
  await expect(page.locator('#combo')).toHaveText('2');
  await page.clock.resume();
  await page.locator('#settings-toggle').click();
  await page.locator('#bpm').fill('100');
  await page.locator('#bpm').blur();
  await page.locator('#start-time').fill('8.5');
  await page.locator('#start-time').blur();
  await page.locator('#offset').fill('200');
  await page.locator('#offset').dispatchEvent('input');
  await page.locator('#debug-toggle').check();
  await page.locator('#settings-close').click();
  await page.locator('#restart').click();
  await expect(page.locator('#chart-info')).toContainText('100 BPM · 8.5秒');
  await expect(page.locator('#debug-bpm')).toHaveText('100');
  await expect(page.locator('#debug-offset')).toHaveText('200 ms');
  await page.reload();
  await expect(page.locator('#restart')).toBeEnabled();
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#bpm')).toHaveValue('100');
  await expect(page.locator('#offset')).toHaveValue('200');
  const dimensions = await page.locator('#game-canvas').evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, rect: canvas.getBoundingClientRect().width, dpr: Math.min(2,devicePixelRatio) }));
  expect(dimensions.width).toBe(Math.round(dimensions.rect * dimensions.dpr));
  expect(await page.locator('.video-frame').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('result preserves normal video playback and skipped notes never inflate score', async ({ page }) => {
  await seekPlay(page, 45);
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#score')).toHaveText('0');
  await expect(page.locator('#result-accuracy')).toContainText('スキップ');
  expect(await page.evaluate(() => (window as any).testVideo.getPlayerState())).toBe(1);
});

test('IFrame errors stop the game and retain the official video link', async ({ page }) => {
  await seekPlay(page, 12);
  await page.evaluate(() => {
    const video = (window as any).testVideo;
    video.options.events.onError({ target: video, data: 153 });
  });
  await expect(page.locator('#player-error')).toContainText('Referer');
  await expect(page.locator('#restart')).toBeDisabled();
  await page.keyboard.press('s');
  await expect(page.locator('#score')).toHaveText('0');
  await expect(page.locator('.playback-info a')).toHaveAttribute('href', 'https://www.youtube.com/watch?v=pJDfWpZ7CI4');
});

test('video time moves the canvas, overdue notes MISS once, and pause retains judgement', async ({ page }) => {
  await seekPlay(page, 12);
  const before = await page.locator('#game-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.evaluate(() => (window as any).testVideo.seekTo(12.2));
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('MISS');
  const after = await page.locator('#game-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  expect(after).not.toBe(before);
  await page.evaluate(() => (window as any).testVideo.setState(2));
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const paused = await page.locator('#game-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.waitForTimeout(100);
  expect(await page.locator('#game-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(paused);
  expect(await page.evaluate(() => (window as any).testVideo.options.playerVars)).toMatchObject({ origin: 'http://127.0.0.1:5173', playsinline: 1, controls: 1, autoplay: 0 });
});

test('horizontal controls share the requested lane colors and feedback appears at each button', async ({ page }) => {
  await page.locator('.lane-buttons').scrollIntoViewIfNeeded();
  const boxes = await Promise.all(Array.from({ length: 6 }, (_, lane) => page.locator(`.lane-button[data-lane="${lane}"]`).boundingBox()));
  boxes.forEach(box => expect(box!.y).toBeCloseTo(boxes[0]!.y, 1));
  const colors = await page.locator('.lane-button').evaluateAll(buttons => buttons.map(button => (button as HTMLElement).style.getPropertyValue('--lane')));
  expect(colors).toEqual(['#ff739c', '#b9f56c', '#f5f5ff', '#ff5b66', '#bd9bff', '#ffe779']);
  await seekPlay(page, 12);
  await page.keyboard.press('s');
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText(/PERFECT|GREAT/);
  expect(await page.locator('.scoreboard .lane-judgement').count()).toBe(0);
  const judgement = (await page.locator('#judgement-0').boundingBox())!;
  const button = (await page.locator('.lane-button[data-lane="0"]').boundingBox())!;
  expect(judgement.y + judgement.height).toBeLessThanOrEqual(button.y);
  const receptor = (await page.locator('.lane-receptor').first().boundingBox())!;
  expect(judgement.y + judgement.height).toBeLessThan(receptor.y);
  expect(receptor.y - judgement.y).toBeLessThan(40);
  expect(receptor.y + receptor.height).toBeLessThan(button.y);
  const waitUntilGood = await page.evaluate(() => (12 + 60 / 140 + 0.125 - (window as any).testVideo.getCurrentTime()) * 1000);
  await page.waitForTimeout(Math.max(0, waitUntilGood));
  await page.keyboard.press('f');
  await expect(page.locator('#judgement-2 .judgement-label')).toHaveText('GOOD');
  await expect(page.locator('#combo')).toHaveText('2');
});

test('mobile dock remains reachable on small screens, resize and scroll', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-touch', 'Touch-device layout');
  for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 390, height: 600 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => page.locator('.lane-button').evaluateAll(buttons => buttons.every(button => {
      const rect = button.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight - 10 && rect.left >= 0 && rect.right <= innerWidth && rect.width >= 44 && rect.height >= 44;
    }))).toBe(true);
    const dock = (await page.locator('.controls-dock').boundingBox())!;
    const video = (await page.locator('.video-frame').boundingBox())!;
    expect(video.y + video.height <= dock.y || video.x + video.width <= dock.x).toBe(true);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(async () => page.locator('.lane-button').evaluateAll(buttons => buttons.every(button => {
      const rect = button.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight - 10;
    }))).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.setViewportSize({ width: 390, height: 600 });
  await expect.poll(() => page.locator('#game-canvas').evaluate(canvas => {
    const field = canvas.getBoundingClientRect();
    return [...document.querySelectorAll('.lane-button')].every(button => {
      const r = button.getBoundingClientRect();
      return r.left >= field.left && r.right <= field.right && r.top >= field.top && r.bottom <= field.bottom;
    });
  })).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile-controls.png') });
});

test('tap sound uses live Web Audio on user input, does not repeat, and can be muted persistently', async ({ page }) => {
  // Count real sound-buffer starts while retaining the browser's AudioContext behavior.
  await page.evaluate(() => {
    (window as any).tapStarts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      (window as any).tapStarts++;
      (window as any).tapDuration = this.buffer?.duration;
      return start.apply(this, args);
    };
  });
  await page.keyboard.down('s');
  await expect.poll(() => page.evaluate(() => (window as any).tapStarts)).toBe(1);
  expect(await page.evaluate(() => (window as any).tapDuration)).toBeCloseTo(0.24, 3);
  await page.keyboard.down('s');
  expect(await page.evaluate(() => (window as any).tapStarts)).toBe(1);
  await page.keyboard.up('s');
  await page.keyboard.press('d');
  await expect.poll(() => page.evaluate(() => (window as any).tapStarts)).toBe(2);
  await page.locator('#settings-toggle').click();
  await page.locator('#sound-volume').fill('90');
  await page.locator('#sound-volume').dispatchEvent('input');
  await expect(page.locator('#sound-volume-value')).toHaveText('90%');
  await page.locator('#sound-volume').fill('0');
  await page.locator('#sound-volume').dispatchEvent('input');
  await page.locator('#settings-close').click();
  await page.keyboard.press('f');
  expect(await page.evaluate(() => (window as any).tapStarts)).toBe(2);
  await page.locator('#settings-toggle').click();
  await page.locator('#sound-volume').fill('90');
  await page.locator('#sound-volume').dispatchEvent('input');
  await page.locator('#sound-toggle').uncheck();
  await page.locator('#settings-close').click();
  await page.keyboard.press('f');
  expect(await page.evaluate(() => (window as any).tapStarts)).toBe(2);
  await page.reload();
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#sound-toggle')).not.toBeChecked();
  await expect(page.locator('#sound-volume')).toHaveValue('90');
});

test('repeated touch inputs leave the playfield and scroll position stable without moving focus', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-touch', 'Mobile touch focus regression');
  // This checks layout/focus under repeated taps, independently of automation delivery time.
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  const geometry = () => page.locator('#game-canvas').evaluate(canvas => {
    const rect = canvas.getBoundingClientRect();
    return { top: rect.top, height: rect.height, scroll: scrollY };
  });
  await page.evaluate(() => document.body.focus());
  const activeBefore = await page.evaluate(() => document.activeElement?.tagName);
  await seekPlay(page, 12);
  const before = await geometry();
  for (let i = 0; i < 12; i++) await page.locator(`.lane-button[data-lane="${i % 6}"]`).tap();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(activeBefore);
  expect(await geometry()).toEqual(before);
  expect(Number((await page.locator('#score').textContent())!.replaceAll(',', ''))).toBeGreaterThan(0);
  // Feedback expiry must not resize the runway either.
  await page.clock.runFor(850);
  expect(await geometry()).toEqual(before);
});

test('mobile browser chrome height changes do not resize the runway or switch compact layout', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-touch', 'Mobile browser chrome regression');
  // Emulate stable small-viewport height while the visible viewport changes as
  // the address bar opens/closes. An actual orientation change is covered above.
  await page.locator('.viewport-size-reference').evaluate((reference: HTMLElement) => { reference.style.height = '600px'; });
  await expect(page.locator('html')).toHaveClass('compact-viewport');
  const geometry = () => page.locator('#game-canvas').evaluate(canvas => {
    const rect = canvas.getBoundingClientRect();
    return { top: rect.top, height: rect.height, line: rect.bottom - 25 };
  });
  await expect.poll(async () => (await geometry()).height).toBeGreaterThanOrEqual(224);
  const before = await geometry();
  for (const height of [700, 650, 600, 700, 844]) {
    await page.setViewportSize({ width: 390, height });
    await page.waitForTimeout(80);
    expect(await geometry()).toEqual(before);
    await expect(page.locator('html')).toHaveClass('compact-viewport');
  }
});

test('sparse video timestamps still produce moving notes every animation frame and pause stops them', async ({ page }) => {
  await page.evaluate(() => { (window as any).testVideo.updateInterval = 0.25; });
  await seekPlay(page, 11.5);
  const capture = () => page.evaluate(async () => {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    const original = CanvasRenderingContext2D.prototype.roundRect;
    let rows: number[] = [];
    CanvasRenderingContext2D.prototype.roundRect = function (...args) {
      if (this.canvas === canvas && args[0] < canvas.getBoundingClientRect().width / 6 && args[3] > 0 && args[3] <= args[2]) rows.push(args[1]);
      return original.apply(this, args);
    };
    const samples: { raw: number; y: number }[] = [];
    try {
      for (let i = 0; i < 10; i++) {
        rows = [];
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        samples.push({ raw: (window as any).testVideo.getCurrentTime(), y: Math.max(...rows) });
      }
    } finally { CanvasRenderingContext2D.prototype.roundRect = original; }
    return samples;
  });
  const moving = await capture();
  expect(moving.some((sample, i) => i > 0 && sample.raw === moving[i - 1].raw)).toBe(true);
  for (let i = 1; i < moving.length; i++) expect(moving[i].y).toBeGreaterThan(moving[i - 1].y);
  await page.evaluate(() => (window as any).testVideo.setState(2));
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const paused = await capture();
  for (const sample of paused) expect(sample.y).toBe(paused[0].y);
});

test('loss of video timestamp updates stops prediction and recovery resynchronizes', async ({ page }) => {
  await seekPlay(page, 11.5);
  await page.evaluate(() => { (window as any).testVideo.liveClock = false; });
  await expect(page.locator('#player-status')).toContainText('更新待ち');
  const frozen = await page.locator('#game-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.waitForTimeout(100);
  expect(await page.locator('#game-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(frozen);
  await page.evaluate(() => {
    const video = (window as any).testVideo;
    video.seekTo(13); video.liveClock = true;
  });
  await expect(page.locator('#player-status')).toContainText('プレイ中');
  await expect(page.locator('#game-notice')).toContainText('再同期');
});
