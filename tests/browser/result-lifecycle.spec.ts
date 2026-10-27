import {test,expect} from '@playwright/test';
import {api} from './mock-video';

test.beforeEach(async({page})=>{
  await page.clock.install({time:new Date('2026-10-17T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-17T00:00:01Z'));
  await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
  await page.addInitScript(()=>{
    localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false}));
    localStorage.setItem('hey-rhythm-custom-chart-v1',JSON.stringify({videoId:'pJDfWpZ7CI4',title:'result',bpm:120,startTime:10,
      notes:[{id:1,type:'tap',lane:0,time:10},{id:2,type:'tap',lane:3,time:11}]}));
  });
  await page.goto('/game.html?chart=custom');
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).testVideo))).toBe(true);
  await page.clock.runFor(100);await expect(page.locator('#restart')).toBeEnabled();
  await page.evaluate(()=>{const video=(window as any).testVideo;video.seekTo(10);video.playVideo();});
  await page.clock.runFor(16);await page.keyboard.press('s');
});

test('results wait for the afterglow and stay through video end and seek until explicitly dismissed or restarted',async({page})=>{
  await page.clock.runFor(1000);await page.keyboard.press('j');
  await expect(page.locator('#score')).toHaveText('2,000');
  await expect(page.locator('#result')).not.toBeVisible();
  await page.clock.runFor(1400);await expect(page.locator('#result')).not.toBeVisible();
  await page.clock.runFor(200);await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result-score')).toHaveText('2,000');
  await expect(page.locator('#result-share')).not.toBeVisible();
  await expect(page.locator('#result-share')).not.toHaveAttribute('href',/.+/);
  await page.evaluate(()=>{const video=(window as any).testVideo;video.pauseVideo();video.seekTo(0);video.setState(0);});
  await page.clock.runFor(5000);
  await expect(page.locator('#result')).toBeVisible();await expect(page.locator('#combo')).toHaveText('2');
  await page.evaluate(()=>{const video=(window as any).testVideo;video.seekTo(5);video.playVideo();});
  await page.clock.runFor(1000);await expect(page.locator('#result-score')).toHaveText('2,000');
  await expect(page.locator('#result')).toBeVisible();
  await page.locator('#result-close').click();await page.clock.runFor(2000);await expect(page.locator('#result')).not.toBeVisible();
  await page.locator('.playback-details summary').click();await page.locator('#show-result').click();
  await expect(page.locator('#result')).toBeVisible();
  await page.locator('#restart').click();await page.clock.runFor(32);
  await expect(page.locator('#result')).not.toBeVisible();await expect(page.locator('#score')).toHaveText('0');
});

test('video end settles the last unjudged note without losing the score if its playhead resets',async({page})=>{
  await expect(page.locator('#score')).toHaveText('1,000');
  await page.evaluate(()=>{const video=(window as any).testVideo;video.pauseVideo();video.seekTo(0);video.setState(0);});
  await page.clock.runFor(1400);await expect(page.locator('#result')).not.toBeVisible();
  await page.clock.runFor(250);await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result-score')).toHaveText('1,000');
  await expect(page.locator('#result-counts div').filter({hasText:'MISS'}).locator('strong')).toHaveText('1');
  await page.clock.runFor(3000);await expect(page.locator('#result-score')).toHaveText('1,000');
});
