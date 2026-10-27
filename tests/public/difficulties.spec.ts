import {test,expect} from '@playwright/test';
import {api} from '../browser/mock-video';

test.beforeEach(async({page})=>{
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
});
test('existing charts are normal and missing levels cannot start another difficulty',async({page})=>{
  await page.goto('/');
  for(const song of ['super-mommy-girls','biscuit-case']){
    const card=page.locator(`[data-song="${song}"]`),select=card.locator('.song-difficulty');
    await expect(select).toHaveValue('normal');await expect(select.locator('option')).toHaveCount(3);
    await select.selectOption('easy');await expect(card.locator('.song-play')).toHaveCount(0);await expect(card.locator('.song-unavailable')).toHaveText('準備中');
    await select.selectOption('hard');await expect(card.locator('.song-play')).toHaveCount(0);
    await select.selectOption('normal');await expect(card.locator('.song-play')).toBeVisible();
  }
  await page.locator('[data-song="biscuit-case"] .song-play').click();await expect(page.locator('#restart')).toBeEnabled();
  await expect(page.locator('#song-difficulty')).toHaveText('ふつう');await expect(page.locator('#stage-song-title')).toContainText('ふつう');
  await expect(page.locator('#chart-info')).toContainText('753 NOTES');
});
test('unknown and unpublished difficulty links return to selection before loading YouTube',async({page})=>{
  const youtube:string[]=[];page.on('request',request=>{if(request.url().includes('youtube.com'))youtube.push(request.url());});
  await page.goto('/game.html?difficulty=expert');await expect(page).toHaveURL(/missing-difficulty=1/);
  await expect(page.locator('#menu-notice')).toContainText('難易度');
  await page.goto('/game.html?difficulty=easy');await expect(page).toHaveURL(/unavailable-song=1/);
  expect(youtube).toEqual([]);
});
