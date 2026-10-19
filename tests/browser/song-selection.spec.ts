import { test, expect } from '@playwright/test';
import { api } from './mock-video';

// An extra test-only entry exercises storage and routing independently of the real catalog.
const second = { id: 'second-song', title: 'Second test song', artist: 'Test artist', videoId: 'abcdefghijk', bpm: 120, startTime: 8 };
const firstChart = { videoId: 'pJDfWpZ7CI4', title: 'SUPER MOMMY GIRLS', bpm: 140, beatOrigin: 12, startTime: 12, notes: [{ id: 1, time: 12, lane: 0, type: 'tap' }] };
test.beforeEach(async ({ page }) => {
  await page.route('**/src/songs.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nSONGS.push(${JSON.stringify(second)});\n` });
  });
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ body: api }));
});

test('menu searches registered songs and loads no video before choosing a song', async ({ page }) => {
  const requests: string[] = []; page.on('request', request => { if (request.url().includes('youtube.com')) requests.push(request.url()); });
  await page.goto('/'); await expect(page.locator('.song-card')).toHaveCount(3);
  expect(requests).toEqual([]);
  for (const button of await page.locator('.song-saved').all()) await expect(button).toBeDisabled();
  const viewport = page.viewportSize()!;
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const action of await page.locator('.song-actions > *').all()) expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('.cover-title')).toHaveCount(0);
    for (const card of await page.locator('.song-card').all()) expect((await card.boundingBox())!.height).toBeLessThan(310);
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await page.locator('#song-search').fill('second'); await expect(page.locator('.song-card')).toHaveCount(1);
  await expect(page.locator('.song-name')).toHaveText(second.title);
  await page.locator('#song-search').fill('no-match'); await expect(page.locator('#song-empty')).toBeVisible();
  await page.locator('#song-search').fill('');
  await page.locator('[data-song="second-song"] .song-play').click(); await expect(page.locator('#restart')).toBeEnabled();
  await expect(page.locator('#song-title')).toHaveText(second.title);
  expect(await page.evaluate(() => (window as any).testVideo.options.videoId)).toBe(second.videoId);
  await expect(page.locator('#chart-info')).toContainText('120 BPM · 8.0秒');
  await expect(page.locator('.playback-info a')).toHaveAttribute('href', `https://www.youtube.com/watch?v=${second.videoId}`);
  const logo = (await page.locator('.wordmark').boundingBox())!, actions = (await page.locator('.header-actions').boundingBox())!;
  expect(logo.x + logo.width).toBeLessThanOrEqual(actions.x);
  expect(logo.height).toBeLessThan(35); expect(actions.height).toBeLessThan(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize(viewport);
});

test('drafts, video IDs and editor links stay with their song and old data is preserved', async ({ page }) => {
  await page.goto('/'); await page.evaluate(chart => localStorage.setItem('hey-rhythm-editor-v1', JSON.stringify(chart)), firstChart);
  await page.reload(); await page.locator('[data-song="second-song"] .song-edit').click();
  await expect(page.locator('#record-toggle')).toBeEnabled(); await expect(page.locator('#note-count')).toHaveText('0 NOTES');
  await expect(page.locator('#editor-bpm')).toHaveValue('120'); await expect(page.locator('#beat-origin')).toHaveValue('8');
  expect(await page.evaluate(() => (window as any).testVideo.options.videoId)).toBe(second.videoId);
  await page.evaluate(() => { const video = (window as any).testVideo; video.pauseVideo(); video.seekTo(10.5); });
  await page.locator('#add-note').click(); await expect(page.locator('#save-status')).toContainText('保存しました');
  const data = await page.evaluate(() => ({ first: JSON.parse(localStorage.getItem('hey-rhythm-editor-v1')!), second: JSON.parse(localStorage.getItem('hey-rhythm-editor-v1:second-song')!) }));
  expect(data.first).toEqual(firstChart); expect(data.second).toMatchObject({ videoId: second.videoId, title: second.title });
  expect(data.second.notes[0].time).toBeCloseTo(10.5, 2);
  await page.locator('#import-chart').setInputFiles({ name: 'wrong-song.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(firstChart)) });
  await expect(page.locator('#editor-notice')).toContainText('動画ID'); await expect(page.locator('#note-count')).toHaveText('1 NOTES');
  await page.getByRole('link', { name: '選曲', exact: true }).click();
  await page.locator('[data-song="super-mommy-girls"] .song-edit').click();
  await expect(page.locator('#note-count')).toHaveText('1 NOTES'); await expect(page.locator('#editor-bpm')).toHaveValue('140');
  await page.getByRole('link', { name: '選曲', exact: true }).click();
  await page.locator('[data-song="second-song"] .song-saved').click(); await expect(page.locator('#restart')).toBeEnabled();
  await expect(page.locator('#chart-source')).toHaveValue('custom'); await expect(page.locator('#song-title')).toHaveText(second.title);
  expect(await page.evaluate(() => (window as any).testVideo.options.videoId)).toBe(second.videoId);
  await page.locator('#open-editor').click(); await expect(page).toHaveURL(/editor.html\?song=second-song$/);
  await expect(page.locator('#note-count')).toHaveText('1 NOTES');
});

test('old custom links still work, while unknown song IDs return to selection without a video', async ({ page }) => {
  await page.addInitScript(chart => localStorage.setItem('hey-rhythm-custom-chart-v1', JSON.stringify(chart)), firstChart);
  await page.goto('/?chart=custom'); await expect(page.locator('#restart')).toBeEnabled();
  await expect(page.locator('#chart-source')).toHaveValue('custom'); await expect(page.locator('#chart-info')).toContainText('1 NOTES');
  const requests: string[] = []; page.on('request', request => { if (request.url().includes('youtube.com')) requests.push(request.url()); });
  await page.goto('/game.html?song=missing'); await expect(page.locator('#menu-notice')).toContainText('見つかりません');
  expect(requests).toEqual([]); await expect(page.locator('.song-card')).toHaveCount(3);
  await page.goto('/editor.html?song=missing'); await expect(page.locator('#menu-notice')).toContainText('見つかりません'); expect(requests).toEqual([]);
});

test('song settings are separate while input correction remains shared', async ({ page }) => {
  await page.goto('/game.html?chart=test'); await expect(page.locator('#restart')).toBeEnabled(); await page.locator('#settings-toggle').click();
  await page.locator('#bpm').fill('150'); await page.locator('#bpm').blur();
  await page.locator('#offset').fill('200'); await page.locator('#offset').dispatchEvent('input');
  await page.goto('/game.html?song=second-song'); await expect(page.locator('#restart')).toBeEnabled(); await page.locator('#settings-toggle').click();
  await expect(page.locator('#bpm')).toHaveValue('120'); await expect(page.locator('#offset')).toHaveValue('0');
  await page.locator('#bpm').fill('160'); await page.locator('#bpm').blur();
  await page.locator('#input-offset').fill('75'); await page.locator('#input-offset').dispatchEvent('input');
  await page.goto('/game.html?chart=test'); await expect(page.locator('#restart')).toBeEnabled(); await page.locator('#settings-toggle').click();
  await expect(page.locator('#bpm')).toHaveValue('150'); await expect(page.locator('#offset')).toHaveValue('200'); await expect(page.locator('#input-offset')).toHaveValue('75');
  await page.goto('/game.html?song=second-song'); await expect(page.locator('#restart')).toBeEnabled(); await page.locator('#settings-toggle').click();
  await expect(page.locator('#bpm')).toHaveValue('160');
});

test('menu reports failed draft preparation without losing data and still offers practice', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(chart => { localStorage.setItem('hey-rhythm-editor-v1', JSON.stringify(chart)); }, firstChart);
  await page.reload();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
  await page.locator('[data-song="super-mommy-girls"] .song-saved').click();
  await expect(page.locator('#menu-notice')).toContainText('保存できません');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-editor-v1')!))).toEqual(firstChart);
  await page.locator('[data-song="super-mommy-girls"] .song-play').click(); await expect(page.locator('#restart')).toBeEnabled();
});

test('registered Biscuit Case opens an empty administrator chart without touching the original draft', async ({page}) => {
  await page.addInitScript(chart=>localStorage.setItem('hey-rhythm-editor-v1',JSON.stringify(chart)),firstChart);
  await page.goto('/');await page.locator('[data-song="biscuit-case"] .song-edit').click();
  await expect(page.locator('#record-toggle')).toBeEnabled();
  await expect(page.locator('#editor-bpm')).toHaveValue('200');
  await expect(page.locator('#beat-origin')).toHaveValue('2.95');
  await expect(page.locator('#note-count')).toHaveText('0 NOTES');
  expect(await page.evaluate(()=>(window as any).testVideo.options.videoId)).toBe('JUsGoi24rug');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('hey-rhythm-editor-v1')!))).toEqual(firstChart);
});
