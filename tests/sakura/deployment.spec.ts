import {test,expect} from '@playwright/test';
import {api} from '../browser/mock-video';

test.beforeEach(async({page})=>{
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
  // Keep these deployment checks independent from live Firebase availability.
  await page.route('https://firestore.googleapis.com/**',r=>r.fulfill({status:404,body:'{}'}));
  await page.addInitScript(()=>{
    localStorage.setItem('hey-rhythm-onboarding-v1',JSON.stringify({seen:true,tutorial:true,timing:true}));
    localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false}));
  });
});

test('FTP output serves both songs, settings and administrator entry beneath /rhythm/',async({page})=>{
  const errors:string[]=[],badAssets:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{
    const url=new URL(response.url());
    if(url.origin==='http://127.0.0.1:4185' && response.status()>=400)badAssets.push(url.pathname);
  });
  await page.goto('./');await expect(page.locator('.song-card')).toHaveCount(2);
  await page.locator('#settings-toggle').click();await expect(page.locator('#settings-panel')).toBeVisible();
  await page.locator('#settings-close').click();
  for(const [id,title,videoId] of [
    ['super-mommy-girls','SUPER MOMMY GIRLS','pJDfWpZ7CI4'],
    ['biscuit-case','ビスケットケース','JUsGoi24rug'],
  ]){
    await page.locator(`[data-song="${id}"] .song-play`).click();
    await expect(page).toHaveURL(new RegExp(`/rhythm/game.html\\?song=${id}$`));
    await expect(page.locator('#restart')).toBeEnabled();await expect(page.locator('#song-title')).toHaveText(title);
    expect(await page.evaluate(()=>(window as any).testVideo.options.videoId)).toBe(videoId);
    expect(await page.evaluate(()=>(window as any).testVideo.options.playerVars.origin)).toBe('http://127.0.0.1:4185');
    await page.locator('#play-start').click();await expect(page.locator('#player-status')).toContainText('MVと同期してプレイ中');
    await page.locator('.wordmark').click();await expect(page).toHaveURL('http://127.0.0.1:4185/rhythm/');
  }
  await page.getByRole('link',{name:'管理者ログイン'}).click();await expect(page).toHaveURL(/\/rhythm\/admin.html$/);
  expect(errors).toEqual([]);expect(badAssets).toEqual([]);
});

test('static metadata and OGP image use the Sakura address without requiring JavaScript',async({request})=>{
  for(const file of ['index.html','game.html']){
    const response=await request.get(file);expect(response.status()).toBe(200);
    const html=await response.text(),canonical=file==='index.html'?'https://hey.jpn.org/rhythm/':`https://hey.jpn.org/rhythm/${file}`;
    expect(html).toContain(`<link rel="canonical" href="${canonical}"`);
    expect(html).toContain(`<meta property="og:url" content="${canonical}"`);
    expect(html).toContain('https://hey.jpn.org/rhythm/ogp-test-v1.png');
    expect(html).not.toContain('tkisland.github.io');expect(html).not.toContain('/src/');
  }
  const image=await request.get('ogp-test-v1.png');expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toContain('image/png');
  // Local-only editing pages must not be included in the FTP upload.
  expect((await request.get('editor.html')).status()).toBe(404);
});
