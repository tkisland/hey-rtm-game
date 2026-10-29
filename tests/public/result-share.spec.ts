import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {api} from '../browser/mock-video';

test.beforeEach(async({page,context})=>{
  await page.clock.install({time:new Date('2026-10-27T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-27T00:00:01Z'));
  await page.route('https://firestore.googleapis.com/**',r=>r.fulfill({status:404,body:'{}'}));
  await page.route('**/api/ranking.php**',route=>{
    const action=new URL(route.request().url()).searchParams.get('action');
    return route.fulfill({json:{ok:true,...(action==='status'?{enabled:true}:action==='start'?{token:'a'.repeat(64)}:action==='share'?{id:'b'.repeat(32)}:{entries:[]})}});
  });
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
  await context.route('https://twitter.com/intent/tweet**',r=>r.fulfill({contentType:'text/html',body:'<h1>投稿内容を確認</h1>'}));
  await page.addInitScript(()=>localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false})));
  await page.goto('/game.html');
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).testVideo))).toBe(true);
  await page.clock.runFor(100);await expect(page.locator('#restart')).toBeEnabled();
});

async function begin(page:Page):Promise<void>{
  const start=page.waitForResponse(r=>r.url().includes('action=start'));
  await page.locator('#play-start').click();await page.clock.runFor(16);
  await (await start).finished();await page.clock.runFor(16);
}
async function replay(page:Page):Promise<void>{
  const start=page.waitForResponse(r=>r.url().includes('action=start'));
  await page.locator('#result-replay').click();await page.clock.runFor(32);
  await (await start).finished();await page.clock.runFor(16);
}
test('sharing is user-activated and opens the finalized public result without changing the game',async({page,context})=>{
  const requests:string[]=[];
  context.on('request',request=>{if(new URL(request.url()).hostname==='twitter.com')requests.push(request.url());});
  const share=page.locator('#result-share');await expect(share).not.toBeVisible();await expect(share).not.toHaveAttribute('href',/.+/);
  await begin(page);await page.clock.runFor(7618);await page.keyboard.press('l');await expect(page.locator('#score')).toHaveText('1,968');
  await page.evaluate(()=>{const video=(window as any).testVideo;video.seekTo(220);video.setState(0);});
  await page.clock.runFor(1400);await expect(share).not.toBeVisible();
  await page.clock.runFor(300);await expect(share).toBeVisible();
  const link=new URL((await share.getAttribute('href'))!);
  expect(link.searchParams.get('text')).toContain('SUPER MOMMY GIRLS / ふつう\nSCORE：1,968\nMAX COMBO：1');
  expect(link.searchParams.get('text')).not.toContain('シークでスキップ');
  await expect.poll(()=>page.locator('#result-share').getAttribute('href')).toContain('id%3D');
  const verified=new URL(new URL((await share.getAttribute('href'))!).searchParams.get('text')!.split('\n').at(-1)!);
  expect(verified.pathname).toBe('/rhythm/share.php');expect(Object.fromEntries(verified.searchParams)).toEqual({id:'b'.repeat(32)});
  const finalLink=new URL((await share.getAttribute('href'))!);
  expect(requests).toEqual([]);
  expect((await share.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const popupPromise=page.waitForEvent('popup');await share.click();const popup=await popupPromise;
  await popup.waitForLoadState();expect(popup.url()).toBe(finalLink.href);expect(await popup.evaluate(()=>window.opener)).toBeNull();
  expect(requests).toHaveLength(1);await expect(page.locator('#result-score')).toHaveText('1,968');await expect(page.locator('#result')).toBeVisible();
  await popup.close();await page.locator('#result-close').click();
  await page.locator('.playback-details summary').click();await page.locator('#show-result').click();
  await expect(share).toHaveAttribute('href',finalLink.href);
  await replay(page);
  await expect(share).not.toBeVisible();await expect(share).not.toHaveAttribute('href',/.+/);
  await page.evaluate(()=>{const video=(window as any).testVideo;video.seekTo(220);video.setState(0);});
  await page.clock.runFor(1700);await expect(share).toBeVisible();
  expect(new URL((await share.getAttribute('href'))!).searchParams.get('text')).toContain('SCORE：0\nMAX COMBO：0');
});

test('Biscuit Case shares its own title and play link and distinguishes skipped notes',async({page})=>{
  await page.goto('/game.html?song=biscuit-case&sync=1');
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).testVideo))).toBe(true);
  await page.clock.runFor(100);await expect(page.locator('#restart')).toBeEnabled();
  await page.evaluate(()=>{const video=(window as any).testVideo;video.seekTo(1);video.playVideo();});
  await page.clock.runFor(32);
  await page.evaluate(()=>(window as any).testVideo.seekTo(200));await page.clock.runFor(32);
  await page.evaluate(()=>(window as any).testVideo.setState(0));await page.clock.runFor(1700);
  const link=new URL((await page.locator('#result-share').getAttribute('href'))!);
  expect(link.searchParams.get('text')).toContain('ビスケットケース / ふつう');
  expect(link.searchParams.get('text')).toContain('シークでスキップ：');
  const fallback=new URL(link.searchParams.get('text')!.split('\n').at(-1)!);
  expect(fallback.pathname).toBe('/rhythm/game.html');expect(fallback.searchParams.get('song')).toBe('biscuit-case');
  expect(fallback.searchParams.has('score')).toBe(false);
  expect(link.searchParams.get('text')!.split('\n').at(-1)).not.toContain('sync=');
});

test('a failed share can retry without blocking ranking or publishing a numeric result URL',async({page})=>{
  let attempts=0;
  await page.route('**/api/ranking.php?action=share',r=>r.fulfill(++attempts===1?{status:503,json:{ok:false,code:'unavailable',message:'retry'}}:{json:{ok:true,id:'c'.repeat(32)}}));
  await begin(page);await page.clock.fastForward(220000);await page.clock.runFor(1700);
  const share=page.locator('#result-share');await expect(page.locator('#result-share-retry')).toBeVisible();
  expect(new URL(new URL((await share.getAttribute('href'))!).searchParams.get('text')!.split('\n').at(-1)!).pathname).toBe('/rhythm/game.html');
  await page.locator('#result-share-retry').click();await expect.poll(()=>share.getAttribute('href')).toContain('id%3D'+'c'.repeat(32));
  await expect(page.locator('#result-share-status')).toBeHidden();
});

test('a delayed share response cannot replace the next play result',async({page})=>{
  let release!:()=>void,seen!:()=>void,first=true;
  const wait=new Promise<void>(resolve=>{release=resolve;}),requested=new Promise<void>(resolve=>{seen=resolve;});
  await page.route('**/api/ranking.php?action=share',async route=>{
    if(first){first=false;seen();await wait;await route.fulfill({json:{ok:true,id:'d'.repeat(32)}});}
    else await route.fulfill({json:{ok:true,id:'e'.repeat(32)}});
  });
  await begin(page);await page.clock.fastForward(220000);await page.clock.runFor(1700);await requested;
  await replay(page);
  const oldResponse=page.waitForResponse(r=>r.url().includes('action=share'));release();await oldResponse;
  await page.clock.runFor(32);await expect(page.locator('#result-share')).not.toHaveAttribute('href',/.+/);
  await page.clock.fastForward(220000);await page.clock.runFor(1700);
  await expect.poll(()=>page.locator('#result-share').getAttribute('href')).toContain('id%3D'+'e'.repeat(32));
});
