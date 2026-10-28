import {test,expect} from '@playwright/test';
import {api} from '../browser/mock-video';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false})));
  await page.route('https://firestore.googleapis.com/**',r=>r.fulfill({status:404,body:'{}'}));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
});
test('both songs offer three independent playable difficulties while normal remains the default',async({page})=>{
  await page.goto('/');
  for(const song of ['super-mommy-girls','biscuit-case']){
    const card=page.locator(`[data-song="${song}"]`),select=card.locator('.song-difficulty');
    await expect(select).toHaveValue('normal');await expect(select.locator('option')).toHaveCount(3);
    for(const [level,count] of [['easy',song==='super-mommy-girls'?275:393],['hard',song==='super-mommy-girls'?893:998]] as const) {
      await select.selectOption(level);await expect(card.locator('.song-play')).toBeVisible();
      await expect(card.locator('.song-meta')).toContainText(`${count} NOTES`);
      await expect(card.locator('.song-play')).toHaveAttribute('href',`./game.html?song=${song}&difficulty=${level}`);
    }
    await select.selectOption('normal');await expect(card.locator('.song-play')).toBeVisible();
  }
  await page.locator('[data-song="biscuit-case"] .song-play').click();await expect(page.locator('#restart')).toBeEnabled();
  await expect(page.locator('#song-difficulty')).toHaveText('ふつう');await expect(page.locator('#stage-song-title')).toContainText('ふつう');
  await expect(page.locator('#chart-info')).toContainText('753 NOTES');
});
test('unknown difficulty and song links return to selection before loading YouTube',async({page})=>{
  const youtube:string[]=[];page.on('request',request=>{if(request.url().includes('youtube.com'))youtube.push(request.url());});
  await page.goto('/game.html?difficulty=expert');await expect(page).toHaveURL(/missing-difficulty=1/);
  await expect(page.locator('#menu-notice')).toContainText('難易度');
  await page.goto('/game.html?song=missing&difficulty=easy');await expect(page).toHaveURL(/missing-song=1/);
  expect(youtube).toEqual([]);
});

test('easy and hard load their own charts, finish and replay without replacing normal',async({page})=>{
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  for(const [song,count,level,label] of [
    ['super-mommy-girls',275,'easy','かんたん'],['super-mommy-girls',893,'hard','むずかしい'],
    ['biscuit-case',393,'easy','かんたん'],['biscuit-case',998,'hard','むずかしい'],
  ] as const) {
    await page.goto(`/game.html?song=${song}&difficulty=${level}`);await page.clock.runFor(100);
    await expect(page.locator('#chart-info')).toContainText(`${count} NOTES`);await expect(page.locator('#song-difficulty')).toHaveText(label);
    await page.locator('#play-start').click();await page.clock.runFor(32);await page.clock.fastForward(270000);await page.clock.runFor(1700);
    await expect(page.locator('#result-counts div').filter({hasText:'MISS'}).locator('strong')).toHaveText(String(count));
    await page.locator('#result-replay').click();await page.clock.runFor(32);await expect(page.locator('#score')).toHaveText('0');
    await expect(page.locator('#result')).not.toBeVisible();await expect(page.locator('#song-difficulty')).toHaveText(label);
  }
});
