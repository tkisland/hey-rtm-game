import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { api } from '../browser/mock-video';

test.beforeEach(async ({page}) => {
  await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({body:''}));
});
async function begin(page: Page) {
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now()+1000));
  await page.goto('/game.html?sync=1');
  // The API script is asynchronous even with frozen timers; wait for construction before onReady.
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).testVideo))).toBe(true);
  await page.clock.runFor(100); await expect(page.locator('#restart')).toBeEnabled();
}
async function log(page: Page) {
  const download = page.waitForEvent('download');
  await page.locator('.sync-diagnostics [data-action="download"]').evaluate((button:HTMLButtonElement)=>button.click());
  const file=await download; expect(file.suggestedFilename()).toMatch(/^hey-rhythm-sync-\d+\.json$/);
  return JSON.parse(await readFile((await file.path())!,'utf8'));
}
test('normal play loads no diagnostic overlay or diagnostic chunk and keeps separate timing settings', async ({page}) => {
  const requests:string[]=[];page.on('request',request=>requests.push(request.url()));
  await page.goto('/game.html');await expect(page.locator('#restart')).toBeEnabled();
  await expect(page.locator('.sync-diagnostics')).toHaveCount(0);
  expect(requests.some(url=>url.includes('sync-diagnostics'))).toBe(false);
  await page.locator('#settings-toggle').click();
  await expect(page.locator('#settings-panel input')).toHaveCount(2);
  await expect(page.locator('#settings-panel button:not(#settings-close)')).toHaveCount(2);
});
for (const interval of [0, .25]) test(`logs slow API progression with ${interval}s updates and exports bounded local data`, async ({page}) => {
  await begin(page);
  const epoch=await page.evaluate(interval=>{
    const video=(window as any).testVideo; video.seekTo(12);video.playVideo();const epoch=performance.now();
    video.getCurrentTime=()=>{
      const elapsed=(performance.now()-epoch)/1000;
      return video.state===1 ? 12+(interval ? Math.floor(elapsed/interval)*interval : elapsed)*.5 : video.time;
    };
    video.getPlaybackRate=()=>1;return epoch;
  },interval);
  await page.clock.runFor(20000);
  await expect(page.locator('.sync-diagnostics')).toContainText('0.50x / 1.00x');
  const data=await log(page), playing=data.samples.filter((row:any)=>row.playing&&row.elapsedMs>5000);
  expect(data.schemaVersion).toBe(1);expect(data.song.id).toBe('super-mommy-girls');expect(data.clockLimits.maxLead).toBe(.05);
  expect(data.samples.length).toBeGreaterThan(50);expect(data.samples.length).toBeLessThanOrEqual(480);
  expect(playing.length).toBeGreaterThan(40);
  if (!interval) expect(Math.max(...playing.map((row:any)=>row.clockLeadMs))).toBeLessThanOrEqual(50.001);
  expect(Math.max(...playing.map((row:any)=>Math.abs(row.clockTime-(12+(row.atMs-epoch)/1000*.5))))).toBeLessThan(.035);
  for (const row of playing) expect(row.predictionRate).toBeCloseTo(.5,2);
  expect(playing.some((row:any)=>Math.abs(row.observedRate-.5)<.01)).toBe(true);
  expect(data.currentViewport.width).toBeGreaterThan(0);
  // Folding the display keeps recording; it does not pause the video or change preferences.
  await page.locator('.sync-diagnostics summary').evaluate((summary:HTMLElement)=>summary.click());
  await page.clock.runFor(1000);expect(await page.evaluate(()=>(window as any).testVideo.state)).toBe(1);
});
test('separates a saved early-input correction from interpolation in the exported log', async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({noteOffset:0,inputOffset:-120,sound:false})));
  await begin(page);await page.evaluate(()=>{const video=(window as any).testVideo;video.seekTo(12);video.playVideo();});
  await page.clock.runFor(3000);
  const data=await log(page), rows=data.samples.filter((row:any)=>row.playing);
  expect(rows.length).toBeGreaterThan(5);
  for(const row of rows) {
    expect(row.inputOffsetMs).toBe(-120);expect(row.noteLeadMs-row.clockLeadMs).toBeCloseTo(120,5);
  }
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!).inputOffset)).toBe(-120);
});
test('exports startup, API metadata and user-marked transition points without changing saved corrections',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({noteOffset:100,inputOffset:25,sound:false})));
  await begin(page);
  const saved=await page.evaluate(()=>localStorage.getItem('hey-rhythm-settings-v1'));
  await page.evaluate(()=>{
    const video=(window as any).testVideo;video.phase='ad';
    video.getDuration=()=>video.phase==='ad'?5:220;
    video.getVideoLoadedFraction=()=>video.phase==='ad'?.2:.8;
    // An API may keep reporting the requested video even during an ad; no ad detector is inferred.
    video.getVideoUrl=()=>`https://www.youtube.com/watch?v=${video.options.videoId}`;
    video.playVideo();
  });
  await page.clock.runFor(5000);
  await page.evaluate(()=>{const video=(window as any).testVideo;video.phase='content';video.seekTo(0);});
  await page.clock.runFor(300);
  await page.locator('[data-marker="ad-ended"]').click();
  await page.clock.runFor(700);
  await page.locator('[data-marker="noticed-drift"]').click();
  await page.locator('.sync-diagnostics summary').click();
  await page.locator('#restart').click();
  await page.clock.runFor(300);
  await page.locator('.sync-diagnostics summary').click();
  const data=await log(page);
  expect(data.startupSamples.some((row:any)=>row.videoDuration===5)).toBe(true);
  expect(data.startupSamples.some((row:any)=>row.videoDuration===220)).toBe(true);
  expect(data.events.some((row:any)=>row.videoDuration===220&&row.reportedVideoId===data.song.videoId)).toBe(true);
  expect(data.markers.map((m:any)=>m.label)).toEqual(['ad-ended','noticed-drift','restart-request']);
  expect(data.markers[0].lastSample.noteOffsetMs).toBe(100);
  expect(data.samples.some((row:any)=>row.loadedFraction===.8)).toBe(true);
  expect(await page.evaluate(()=>localStorage.getItem('hey-rhythm-settings-v1'))).toBe(saved);
});
