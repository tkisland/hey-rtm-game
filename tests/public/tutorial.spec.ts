import { test, expect } from '@playwright/test';

test('opens on request, keeps selection intact and returns focus when dismissed', async ({ page }) => {
  const videoRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('youtube.com')) videoRequests.push(request.url()); });
  await page.goto('/');
  const dialog = page.getByRole('dialog');
  await expect(dialog).not.toBeVisible();
  await page.locator('#song-search').fill('mommy');
  await page.getByRole('button', {name:'遊び方', exact:true}).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', {name:'タップ', exact:true})).toBeVisible();
  await expect(page.locator('#tutorial-previous')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#open-tutorial')).toBeFocused();
  await expect(page.locator('#song-search')).toHaveValue('mommy');
  await expect(page.locator('.song-card')).toHaveCount(1);
  await page.locator('#open-tutorial').click();
  await page.getByRole('button', {name:'閉じる', exact:true}).click();
  await expect(dialog).not.toBeVisible();
  expect(videoRequests).toEqual([]);
});

test('distinguishes a tap, overlapping presses and a continuous hold with keyboard input', async ({ page }) => {
  await page.goto('/'); await page.locator('#open-tutorial').click();
  const feedback = page.locator('#tutorial-feedback');
  await page.keyboard.press('d'); await expect(feedback).not.toContainText('できました');
  await page.keyboard.press('s'); await expect(feedback).toContainText('できました');
  await page.locator('#tutorial-next').click();
  await page.keyboard.press('s'); await page.keyboard.press('l');
  await expect(feedback).not.toContainText('できました');
  await page.keyboard.down('s'); await page.keyboard.down('l');
  await expect(feedback).toContainText('できました');
  await page.keyboard.up('s'); await page.keyboard.up('l');
  await page.locator('#tutorial-next').click();
  await page.keyboard.down('f'); await expect(feedback).toHaveText('そのままキープ！');
  await page.keyboard.up('f'); await page.waitForTimeout(1100);
  await expect(feedback).not.toContainText('できました');
  await expect(page.locator('#tutorial-progress')).toHaveJSProperty('value', 0);
  await page.keyboard.down('f'); await expect(feedback).toContainText('できました'); await page.keyboard.up('f');
  await page.locator('#tutorial-previous').click(); await page.locator('#tutorial-next').click();
  await page.keyboard.down('f'); await expect(feedback).toHaveText('そのままキープ！');
  await page.locator('#tutorial-close').click(); await page.keyboard.up('f');
  await page.waitForTimeout(1100); await page.locator('#open-tutorial').click();
  await expect(page.locator('#tutorial-step')).toHaveText('1 / 3');
  await expect(feedback).not.toContainText('できました');
  await page.locator('#tutorial-next').click(); await page.locator('#tutorial-next').click();
  await page.locator('#tutorial-next').click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.locator('#open-tutorial').click();
  await expect(page.locator('#tutorial-step')).toHaveText('1 / 3');
  await expect(feedback).not.toContainText('できました');
  await expect(page.locator('#tutorial-progress')).toBeHidden();
});

test('supports two fingers and cancels an interrupted touch hold', async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, 'Requires a touch viewport.');
  await page.goto('/'); await page.locator('#open-tutorial').click();
  await page.locator('#tutorial-pads button').first().tap();
  await expect(page.locator('#tutorial-feedback')).toContainText('できました');
  await page.locator('#tutorial-next').click();
  const touch = await page.context().newCDPSession(page);
  async function points(lanes: number[]) {
    return Promise.all(lanes.map(async lane => {
      const box = (await page.locator('#tutorial-pads button').nth(lane).boundingBox())!;
      return {id:lane + 1, x:box.x + box.width / 2, y:box.y + box.height / 2};
    }));
  }
  await touch.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:await points([0,5])});
  await expect(page.locator('#tutorial-feedback')).toContainText('できました');
  await touch.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  await page.locator('#tutorial-next').click();
  await touch.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:await points([2])});
  await expect(page.locator('#tutorial-feedback')).toHaveText('そのままキープ！');
  await touch.send('Input.dispatchTouchEvent', {type:'touchCancel', touchPoints:[]});
  await page.waitForTimeout(1100);
  await expect(page.locator('#tutorial-feedback')).not.toContainText('できました');
  await touch.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:await points([2])});
  await expect(page.locator('#tutorial-feedback')).toContainText('できました');
  await touch.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  await touch.detach();
});

test('keeps tutorial controls reachable on small portrait and landscape screens', async ({ page }) => {
  for (const [width,height] of [[320,480],[844,390]]) {
    await page.setViewportSize({width,height}); await page.goto('/'); await page.locator('#open-tutorial').click();
    expect(await page.locator('#tutorial').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
    for (let step = 0; step < 3; step++) await page.locator('#tutorial-next').click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
