import { test, expect } from '@playwright/test';
import { api } from './mock-video';

// A different origin models YouTube's isolated document: its key events cannot bubble to the app.
const frameUrl = 'http://localhost:5173/test-player-frame';
const isolatedApi = api.replace("frame.src = 'about:blank';", `frame.src = '${frameUrl}?disablekb=' + (options.playerVars.disablekb || 0);
    window.addEventListener('message', event => {
      if (event.source === frame.contentWindow && event.data?.type === 'test-player-state') this.setState(event.data.state);
    });`).replace('setTimeout(() => options.events.onReady({target:this}), 0);', 'frame.addEventListener("load", () => requestAnimationFrame(() => requestAnimationFrame(() => options.events.onReady({target:this}))), {once:true});');
const frameHtml = `<!doctype html><html><head><meta charset="UTF-8"></head><body>
<button id="play" disabled>再生</button><button id="pause">一時停止</button><div id="surface" tabindex="0">動画領域</div>
<script>
  const disabled = new URLSearchParams(location.search).get('disablekb') === '1';
  document.getElementById('play').onclick = () => parent.postMessage({type:'test-player-state',state:1}, '*');
  document.getElementById('pause').onclick = () => parent.postMessage({type:'test-player-state',state:2}, '*');
  document.getElementById('play').disabled = false;
  document.addEventListener('keydown', event => {
    if (disabled || !['f','j','k','l'].includes(event.key)) return;
    parent.postMessage({type:'test-player-shortcut',key:event.key}, '*');
    if (event.key === 'f') document.documentElement.requestFullscreen().catch(() => {});
  });
</script></body></html>`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).playerShortcuts = [];
    window.addEventListener('message', event => { if (event.data?.type === 'test-player-shortcut') (window as any).playerShortcuts.push(event.data.key); });
  });
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: isolatedApi }));
  await page.route(`${frameUrl}**`, route => route.fulfill({ contentType: 'text/html', body: frameHtml }));
});

test('F/J/K/L do not activate player shortcuts even while the isolated iframe has focus', async ({ page }) => {
  await page.goto('/game.html?chart=test'); await expect(page.locator('#restart')).toBeEnabled();
  await page.frameLocator('iframe').locator('#surface').click();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');
  expect(await page.evaluate(() => { try { document.querySelector('iframe')!.contentWindow!.document; return false; } catch { return true; } })).toBe(true);
  for (const key of ['f', 'j', 'k', 'l']) await page.keyboard.press(key);
  expect(await page.evaluate(() => (window as any).testVideo.options.playerVars.disablekb)).toBe(1);
  expect(await page.evaluate(() => (window as any).playerShortcuts)).toEqual([]);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
});

test('PC playback returns focus to the game for F input; touch playback retains player focus', async ({ page }, info) => {
  await page.goto('/game.html?chart=test'); await expect(page.locator('#restart')).toBeEnabled();
  // Establish the player-focus precondition before its play action.
  await page.frameLocator('iframe').locator('#surface').click();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');
  await page.frameLocator('iframe').locator('#play').click();
  await expect.poll(() => page.evaluate(() => (window as any).testVideo.getPlayerState())).toBe(1);
  if (info.project.name === 'mobile-touch') {
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME'); return;
  }
  await expect(page.locator('#game-canvas')).toBeFocused();
  const scrollBefore = await page.evaluate(() => scrollY);
  await page.evaluate(() => (window as any).testVideo.seekTo(12 + 60 / 140));
  await page.keyboard.down('f'); await expect(page.locator('.lane-button[data-lane="2"]')).toHaveClass(/pressed/); await page.keyboard.up('f');
  expect(Number(await page.locator('#score').textContent())).toBeGreaterThanOrEqual(700);
  expect(await page.evaluate(() => (window as any).playerShortcuts)).toEqual([]);
  expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
  await page.frameLocator('iframe').locator('#pause').click();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');
  await page.frameLocator('iframe').locator('#play').click(); await expect(page.locator('#game-canvas')).toBeFocused();
});

test('editor playback returns PC focus to the recording pads and touch input still records', async ({ page }, info) => {
  await page.goto('/editor.html'); await expect(page.locator('#record-toggle')).toBeEnabled();
  await page.locator('#record-toggle').click();
  await page.frameLocator('iframe').locator('#surface').click();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');
  await page.frameLocator('iframe').locator('#play').click();
  await expect.poll(() => page.evaluate(() => (window as any).testVideo.getPlayerState())).toBe(1);
  if (info.project.name === 'mobile-touch') {
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');
    await page.locator('.lane-button[data-lane="2"]').tap();
  } else {
    await expect(page.locator('#record-pads')).toBeFocused(); await page.keyboard.press('f');
  }
  await expect(page.locator('#note-count')).toHaveText('1 NOTES');
  expect(await page.evaluate(() => (window as any).playerShortcuts)).toEqual([]);
});

test('playback notifications do not steal focus from settings fields', async ({ page }) => {
  await page.goto('/game.html?chart=test'); await expect(page.locator('#restart')).toBeEnabled();
  await page.locator('#settings-toggle').click(); await page.locator('#bpm').focus();
  await page.evaluate(() => {
    const video = (window as any).testVideo; video.setState(3); video.playVideo();
  });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.locator('#bpm')).toBeFocused();
  await page.keyboard.press('f'); await expect(page.locator('.lane-button.pressed')).toHaveCount(0);
});
