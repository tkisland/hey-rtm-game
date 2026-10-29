import {test,expect} from '@playwright/test';
import {api} from '../browser/mock-video';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false})));
  await page.route('https://firestore.googleapis.com/**',r=>r.fulfill({status:404,body:'{}'}));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
});
test('only normal is playable and retained easy/hard charts are marked as preparing',async({page})=>{
  await page.goto('/');
  for(const song of ['super-mommy-girls','biscuit-case']){
    const card=page.locator(`[data-song="${song}"]`),select=card.locator('.song-difficulty');
    await expect(select).toHaveValue('normal');await expect(select.locator('option')).toHaveCount(3);
    for(const [level,label] of [['easy','かんたん'],['hard','むずかしい']]) {
      await expect(select.locator(`option[value="${level}"]`)).toHaveText(`${label}（準備中）`);
      await select.selectOption(level);await expect(card.locator('.song-play')).toHaveCount(0);
      await expect(card.locator('.song-unavailable')).toHaveText('準備中');
    }
    await select.selectOption('normal');await expect(card.locator('.song-play')).toBeVisible();
  }
  await page.locator('[data-song="biscuit-case"] .song-play').click();await expect(page.locator('#restart')).toBeEnabled();
  await expect(page.locator('#song-difficulty')).toHaveText('ふつう');
  await expect(page.locator('#chart-info')).toContainText('753 NOTES');
});
test('unknown difficulty and song links return to selection before loading YouTube',async({page})=>{
  const youtube:string[]=[];page.on('request',request=>{if(request.url().includes('youtube.com'))youtube.push(request.url());});
  await page.goto('/game.html?difficulty=expert');await expect(page).toHaveURL(/missing-difficulty=1/);
  await expect(page.locator('#menu-notice')).toContainText('難易度');
  await page.goto('/game.html?song=missing&difficulty=easy');await expect(page).toHaveURL(/missing-song=1/);
  expect(youtube).toEqual([]);
});

test('unpublished difficulty URLs cannot load YouTube or expose rankings',async({page})=>{
  const youtube:string[]=[];page.on('request',request=>{if(request.url().includes('youtube.com'))youtube.push(request.url());});
  for(const song of ['super-mommy-girls','biscuit-case'])for(const level of ['easy','hard']) {
    await page.goto(`/game.html?song=${song}&difficulty=${level}`);
    await expect(page).toHaveURL(/unavailable-song=1/);
    await expect(page.locator('#menu-notice')).toContainText('準備中');
    await page.goto(`/rankings.html?song=${song}&difficulty=${level}`);
    await expect(page.locator('#ranking-page-status')).toContainText('準備中');
    await expect(page.locator('#ranking-play')).toBeHidden();
  }
  expect(youtube).toEqual([]);
});
