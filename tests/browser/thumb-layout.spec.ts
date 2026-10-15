import { test, expect } from '@playwright/test';
import { api, seekPlay } from './mock-video';

test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ body: api }));
  await page.addInitScript(() => {
    localStorage.setItem('hey-rhythm-settings-v1', JSON.stringify({ sound: false }));
    localStorage.setItem('hey-rhythm-custom-chart-v1', JSON.stringify({
      videoId: 'pJDfWpZ7CI4', title: 'test', bpm: 120, startTime: 12,
      notes: [0, 5].map(lane => ({ id: lane + 1, lane, time: 12, type: 'hold', endTime: 16 })),
    }));
  });
  await page.goto('/game.html?chart=custom'); await expect(page.locator('#restart')).toBeEnabled();
});

test('all six thumb pads leave the complete timing window above the input row across screen sizes', async ({ page }, info) => {
  const sizes = [[320, 480], [390, 844], [640, 360], [1280, 900]];
  if (info.project.name === 'mobile-touch') sizes.push([844, 390]);
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.locator('#game-canvas').evaluate(async (canvas: HTMLCanvasElement) => {
      const { fieldGeometry, timingBands } = await import('/src/field-geometry.ts');
      const r = canvas.getBoundingClientRect(), field = fieldGeometry(r.width, r.height);
      return [...document.querySelectorAll<HTMLElement>('.lane-control')].every((control, lane) => {
        const pad = control.querySelector('.lane-button')!.getBoundingClientRect();
        const receptor = control.querySelector('.lane-receptor')!.getBoundingClientRect();
        const lateGood = timingBands(field, lane, 1)[0].bottom.y + r.y;
        return pad.width >= 44 && pad.height >= 60 && receptor.bottom < pad.top &&
          lateGood <= pad.top - 15.9 && Math.abs(receptor.x + receptor.width / 2 - pad.x - pad.width / 2) < .1 &&
          getComputedStyle(control.querySelector('.lane-receptor')!).borderTopStyle === 'solid';
      });
    })).toBe(true);
  }
});

test('two thumbs can hold the lower pads while the receptors and HOLD feedback remain above their contacts', async ({ page }) => {
  await page.locator('.lane-buttons').scrollIntoViewIfNeeded();
  const session = await page.context().newCDPSession(page);
  const receptors = await page.locator('.lane-receptor').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }));
  await seekPlay(page, 12);
  // The upper receptor is a visual cue, not a second touch input.
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...receptors[0] }] });
  await expect(page.locator('.lane-button.pressed')).toHaveCount(0);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const contacts = await page.locator('.lane-button').evaluateAll(nodes => [0, 5].map(lane => {
    const r = nodes[lane].getBoundingClientRect();
    return { id: lane + 1, x: r.x + r.width / 2, y: r.y + r.height * .72, radiusX: 24, radiusY: 28 };
  }));
  await seekPlay(page, 12);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: contacts });
  await expect(page.locator('.lane-button.holding')).toHaveCount(2);
  for (const lane of [0, 5]) {
    await expect(page.locator(`#judgement-${lane} .judgement-label`)).toHaveText('HOLD');
    const feedback = (await page.locator(`#judgement-${lane}`).boundingBox())!;
    const receptor = (await page.locator('.lane-receptor').nth(lane).boundingBox())!;
    const contact = contacts[lane === 0 ? 0 : 1];
    expect(feedback.y + feedback.height).toBeLessThan(receptor.y);
    expect(receptor.y + receptor.height).toBeLessThan(contact.y - contact.radiusY);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [contacts[0]] });
  await expect(page.locator('.lane-button.holding')).toHaveCount(1);
  await expect(page.locator('#judgement-5 .judgement-label')).toHaveText('HOLD');
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.lane-button.pressed')).toHaveCount(0);
});
