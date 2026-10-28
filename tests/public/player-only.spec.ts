import { test, expect } from '@playwright/test';
import { api, seekPlay } from '../browser/mock-video';

const draft = { videoId:'pJDfWpZ7CI4', title:'old local draft', bpm:120, startTime:1, notes:[{id:1, lane:0, type:'tap', time:1}] };
test.beforeEach(async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({body:api}));
  await page.addInitScript(draft => {
    if (!localStorage.getItem('hey-rhythm-editor-v1')) localStorage.setItem('hey-rhythm-editor-v1', JSON.stringify(draft));
    if (!localStorage.getItem('hey-rhythm-custom-chart-v1')) localStorage.setItem('hey-rhythm-custom-chart-v1', JSON.stringify(draft));
    if (!localStorage.getItem('hey-rhythm-settings-v1')) localStorage.setItem('hey-rhythm-settings-v1', JSON.stringify({bpm:199, startTime:55, debug:true, sound:false, travel:3.25}));
    localStorage.setItem('admin', 'true'); localStorage.setItem('isAdmin', 'true');
  }, draft);
});

test('public selection offers only the published chart and loads no video', async ({ page }) => {
  const requests:string[] = [];
  page.on('request', request => { if (request.url().includes('youtube.com')) requests.push(request.url()); });
  await page.goto('/?admin=1&mode=admin');
  await expect(page.locator('[data-song="super-mommy-girls"] .song-play')).toHaveText('プレイ');
  await expect(page.locator('[data-song="super-mommy-girls"] .song-meta')).toHaveText('6 LANES · 166 → 192 BPM · 510 NOTES');
  await expect(page.locator('.song-card').getByText('SUPER MOMMY GIRLS',{exact:true})).toHaveCount(1);
  expect((await page.locator('[data-song="super-mommy-girls"]').boundingBox())!.height).toBeLessThan(180);
  await expect(page.locator('.song-edit,.song-saved,.song-practice,.saved-summary,.admin-notice')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(/エディター|編集|保存譜面|練習譜面|SMG00[234]/);
  expect(requests).toEqual([]);
  await page.locator('#song-search').fill('missing'); await expect(page.locator('#song-empty')).toBeVisible();
  await page.locator('#song-search').fill('mommy'); await expect(page.locator('.song-card')).toHaveCount(2);
  await page.locator('[data-song="super-mommy-girls"] .song-play').click(); await expect(page.locator('#restart')).toBeEnabled();
  await expect(page.locator('#chart-info')).toHaveText('166 → 192 BPM · 510 NOTES');
});

test('public play ignores old drafts and chart settings while retaining device preferences', async ({ page }) => {
  const errors:string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/game.html?chart=custom&admin=1'); await expect(page.locator('#restart')).toBeEnabled();
  await expect(page.locator('#open-editor,#chart-source,#bpm,#start-time,#debug-toggle,#debug-panel')).toHaveCount(0);
  await expect(page.locator('#chart-info')).toHaveText('166 → 192 BPM · 510 NOTES');
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#travel')).toHaveValue('3.25');
  await expect(page.locator('#sound-toggle,#offset,#input-offset,#sound-delay,#auto-calibrate,#timing-reset,#sound-test')).toHaveCount(0);
  await expect(page.locator('#sound-volume')).toHaveValue('0');
  expect(await page.locator('#settings-panel').innerText()).not.toMatch(/編集|エディター|下書き|仮BPM|譜面開始|使用する譜面/);
  await page.locator('#sound-volume').fill('0'); await page.locator('#sound-volume').dispatchEvent('input');
  await page.locator('#settings-close').click();
  await page.locator('#play-start').click();
  expect(await page.evaluate(() => (window as any).testVideo.getCurrentTime())).toBeLessThan(.5);
  await seekPlay(page, 7.65); await page.keyboard.press('l');
  await expect(page.locator('#judgement-5 .judgement-label')).toHaveText(/PERFECT|GREAT|GOOD/);
  expect(Number((await page.locator('#score').textContent())!.replaceAll(',', ''))).toBeGreaterThan(0);
  await page.locator('#restart').click(); await expect(page.locator('#score')).toHaveText('0');
  await page.reload(); await expect(page.locator('#restart')).toBeEnabled();
  await page.locator('#settings-toggle').click(); await expect(page.locator('#travel')).toHaveValue('3.25');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!).travel)).toBe(3.25);
  const stored = await page.evaluate(() => ['hey-rhythm-editor-v1','hey-rhythm-custom-chart-v1'].map(key => JSON.parse(localStorage.getItem(key)!)));
  expect(stored).toEqual([draft,draft]); expect(errors).toEqual([]);
});

test('legacy draft and practice URLs resolve to the published chart', async ({ page }) => {
  for (const url of ['/?chart=custom', '/?chart=test', '/game.html?chart=test', '/game.html?chart=custom&mode=admin']) {
    await page.goto(url); await expect(page.locator('#restart')).toBeEnabled();
    await expect(page.locator('#chart-info')).toHaveText('166 → 192 BPM · 510 NOTES');
    expect(new URL(page.url()).searchParams.has('chart')).toBe(false);
    await expect(page.locator('#open-editor,#chart-source')).toHaveCount(0);
  }
});

test('direct editor URLs and source or asset requests return 404', async ({ request }) => {
  for (const path of ['/editor.html', '/editor', '/editor.html?admin=1', '/%65ditor.html', '/src/editor.ts', '/src/editor.ts?raw', '/src/timeline.ts', '/assets/editor-hu93NUmn.js']) {
    const response = await request.get(path); expect(response.status(), path).toBe(404);
    expect(await response.text()).not.toContain('record-toggle');
  }
});

test('the default development server rejects editor pages, source and Vite aliases', async ({ request }) => {
  for (const path of ['/editor.html','/editor','/%65ditor?mode=admin','/Editor.html','/src/editor.ts?raw','/src/editor.js','/src/editor.js?raw']) {
    const response = await request.get(`http://127.0.0.1:4183${path}`);
    expect(response.status(), path).toBe(404); expect(await response.text()).not.toContain('record-toggle');
  }
});

test('unknown songs return to selection before loading a player', async ({ page }) => {
  const requests:string[] = [];
  page.on('request', request => { if (request.url().includes('youtube.com')) requests.push(request.url()); });
  await page.goto('/game.html?song=unknown&admin=1');
  await expect(page.locator('#menu-notice')).toContainText('見つかりません');
  await expect(page.locator('[data-song="super-mommy-girls"] .song-play')).toBeVisible(); expect(requests).toEqual([]);
});
test('the unconfigured administrator entry stays locked and does not load the editor', async ({ page }) => {
  const requests:string[]=[];page.on('request',request=>requests.push(request.url()));
  await page.goto('/admin.html?admin=1');
  await expect(page.locator('#login-status')).toContainText('準備中');
  await expect(page.locator('#google-login')).toBeDisabled();
  await expect(page.locator('#record-toggle')).toHaveCount(0);
  expect(requests.some(url=>url.includes('editor-controller')||url.includes('youtube.com'))).toBe(false);
});

test('player controls remain reachable with clearance from the bottom on small screens', async ({ page }, info) => {
  for (const [width,height] of [[320,480],[390,844],...(info.project.name === 'mobile-touch' ? [[844,390]] : [])]) {
    await page.setViewportSize({width,height}); await page.goto('/game.html');
    await expect(page.locator('#restart')).toBeEnabled();
    await expect.poll(() => page.evaluate(() => {
      return [...document.querySelectorAll('.lane-button'),document.getElementById('play-start')!].every(node => {
        const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        return r.top >= 0 && r.bottom <= innerHeight && (hit === node || node.contains(hit));
      }) && [...document.querySelectorAll('.lane-button')].every(node => innerHeight-node.getBoundingClientRect().bottom >= 43.9);
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('Biscuit Case plays the uploaded BSC002 chart at MIDI zero plus 2.95s', async ({page}) => {
  await page.goto('/');await expect(page.locator('#song-count')).toHaveText('2曲 / 全2曲');
  await page.locator('#song-search').fill('ビスケット');
  const card=page.locator('[data-song="biscuit-case"]');
  await expect(card.locator('.song-name')).toHaveText('ビスケットケース');
  await expect(card.locator('.song-meta')).toHaveText('6 LANES · 200 → 205 → 200 → 205 → 203 → 205 → 200 BPM · 753 NOTES');
  await card.locator('.song-play').click();await expect(page.locator('#restart')).toBeEnabled();
  await expect(page.locator('#song-title')).toHaveText('ビスケットケース');
  expect(await page.evaluate(()=>(window as any).testVideo.options.videoId)).toBe('JUsGoi24rug');
  await page.evaluate(()=>{const video=(window as any).testVideo;video.liveClock=false;video.seekTo(3.85);video.playVideo();});
  await page.keyboard.press('l');await expect(page.locator('#judgement-5 .judgement-label')).toHaveText('PERFECT');
  await expect(page.locator('#score')).toHaveText('1,328');
  await page.locator('#restart').click();await expect(page.locator('#score')).toHaveText('0');
  await page.reload();await expect(page.locator('#chart-info')).toContainText('753 NOTES');
});
