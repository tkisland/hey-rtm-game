import {test,expect} from '@playwright/test';
import {api} from '../browser/mock-video';

test.beforeEach(async({page,context})=>{
  await page.clock.install({time:new Date('2026-10-27T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-27T00:00:01Z'));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
  await context.route('https://twitter.com/intent/tweet**',r=>r.fulfill({contentType:'text/html',body:'<h1>投稿内容を確認</h1>'}));
  await page.addInitScript(()=>localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false})));
  await page.goto('/game.html');await page.clock.runFor(100);await expect(page.locator('#restart')).toBeEnabled();
});

test('sharing is user-activated and opens the finalized public result without changing the game',async({page,context})=>{
  const requests:string[]=[];
  context.on('request',request=>{if(new URL(request.url()).hostname==='twitter.com')requests.push(request.url());});
  const share=page.locator('#result-share');await expect(share).not.toBeVisible();await expect(share).not.toHaveAttribute('href',/.+/);
  await page.evaluate(()=>{const video=(window as any).testVideo;video.liveClock=false;video.seekTo(7.65);video.playVideo();});
  await page.clock.runFor(16);await page.keyboard.press('l');await expect(page.locator('#score')).toHaveText('1,960');
  await page.evaluate(()=>{const video=(window as any).testVideo;video.seekTo(220);video.setState(0);});
  await page.clock.runFor(1400);await expect(share).not.toBeVisible();
  await page.clock.runFor(300);await expect(share).toBeVisible();
  const link=new URL((await share.getAttribute('href'))!);
  expect(link.searchParams.get('text')).toContain('SUPER MOMMY GIRLS / ふつう\nSCORE：1,960\nMAX COMBO：1');
  expect(link.searchParams.get('text')).not.toContain('シークでスキップ');
  const shared=new URL(link.searchParams.get('url')!);
  expect(shared.pathname).toBe('/rhythm/share.php');expect(shared.searchParams.get('score')).toBe('1960');expect(shared.searchParams.get('base')).toBe('1960');
  expect(requests).toEqual([]);
  expect((await share.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const popupPromise=page.waitForEvent('popup');await share.click();const popup=await popupPromise;
  await popup.waitForLoadState();expect(popup.url()).toBe(link.href);expect(await popup.evaluate(()=>window.opener)).toBeNull();
  expect(requests).toHaveLength(1);await expect(page.locator('#result-score')).toHaveText('1,960');await expect(page.locator('#result')).toBeVisible();
  await popup.close();await page.locator('#result-close').click();
  await page.locator('.playback-details summary').click();await page.locator('#show-result').click();
  await expect(share).toHaveAttribute('href',link.href);
  await page.locator('#result-replay').click();await page.clock.runFor(32);
  await expect(share).not.toBeVisible();await expect(share).not.toHaveAttribute('href',/.+/);
  await page.evaluate(()=>{const video=(window as any).testVideo;video.seekTo(220);video.setState(0);});
  await page.clock.runFor(1700);await expect(share).toBeVisible();
  expect(new URL((await share.getAttribute('href'))!).searchParams.get('text')).toContain('SCORE：0\nMAX COMBO：0');
});

test('Biscuit Case shares its own title and play link and distinguishes skipped notes',async({page})=>{
  await page.goto('/game.html?song=biscuit-case&sync=1');await page.clock.runFor(100);await expect(page.locator('#restart')).toBeEnabled();
  await page.evaluate(()=>{const video=(window as any).testVideo;video.seekTo(1);video.playVideo();});
  await page.clock.runFor(32);
  await page.evaluate(()=>(window as any).testVideo.seekTo(200));await page.clock.runFor(32);
  await page.evaluate(()=>(window as any).testVideo.setState(0));await page.clock.runFor(1700);
  const link=new URL((await page.locator('#result-share').getAttribute('href'))!);
  expect(link.searchParams.get('text')).toContain('ビスケットケース / ふつう');
  expect(link.searchParams.get('text')).toContain('シークでスキップ：');
  expect(new URL(link.searchParams.get('url')!).searchParams.get('song')).toBe('biscuit-case');
  expect(link.searchParams.get('url')).not.toContain('sync=');
});
