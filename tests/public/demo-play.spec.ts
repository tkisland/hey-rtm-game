import {test,expect} from '@playwright/test';
import {api} from '../browser/mock-video';

test.beforeEach(async({page})=>{
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
  await page.addInitScript(()=>localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false,noteOffset:0,inputOffset:200})));
});
test('opens a labelled demonstration, ignores manual input, completes and replays without ranking or sharing',async({page})=>{
  const ranking:string[]=[];page.on('request',r=>{if(r.url().includes('/api/ranking.php'))ranking.push(r.url());});
  await page.goto('/');const card=page.locator('[data-song="super-mommy-girls"]');
  await expect(card.locator('.song-demo')).toHaveAttribute('href','./game.html?song=super-mommy-girls&mode=demo');
  await card.locator('.song-demo').click();
  await expect.poll(()=>page.evaluate(()=>Boolean((window as any).testVideo))).toBe(true);
  await page.clock.runFor(100);await expect(page.locator('#restart')).toBeEnabled();
  await expect(page.locator('#demo-badge')).toBeVisible();
  await page.keyboard.press('l');await expect(page.locator('#score')).toHaveText('0');
  await page.locator('#play-start').click();await page.clock.runFor(7670);
  await expect(page.locator('#score')).toHaveText('1,968');
  await expect(page.locator('.lane-button').nth(5)).toHaveClass(/pressed/);
  await page.evaluate(()=>(window as any).testVideo.pauseVideo());await page.clock.runFor(32);
  const pausedScore=await page.locator('#score').innerText();await page.clock.fastForward(2000);
  await expect(page.locator('#score')).toHaveText(pausedScore);
  await page.locator('#play-start').click();await page.clock.runFor(32);
  for(let second=0;second<211;second++)await page.clock.fastForward(1000);
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result-demo-note')).toBeVisible();
  await expect(page.locator('#result-counts div').filter({hasText:'PERFECT'}).locator('strong')).toHaveText('508');
  await expect(page.locator('#result-counts div').filter({hasText:'MISS'}).locator('strong')).toHaveText('0');
  await expect(page.locator('#result-ranking')).toBeHidden();await expect(page.locator('#result-share')).toBeHidden();
  expect(ranking).toEqual([]);
  await page.getByRole('button',{name:'もういちど見る',exact:true}).click();await page.clock.runFor(32);
  await expect(page.locator('#result')).toBeHidden();await expect(page.locator('#score')).toHaveText('0');
  await page.clock.runFor(7670);await expect(page.locator('#score')).toHaveText('1,968');
});
test('unpublished levels stay unavailable and normal play remains manual',async({page})=>{
  await page.goto('/');const card=page.locator('[data-song="biscuit-case"]');
  await card.locator('.song-difficulty').selectOption('easy');await expect(card.locator('.song-demo')).toHaveCount(0);
  await page.goto('/game.html?song=biscuit-case&difficulty=easy&mode=demo');await expect(page).toHaveURL(/unavailable-song=1/);
  await page.goto('/game.html');await page.clock.runFor(100);await page.locator('#play-start').click();
  await page.clock.runFor(7700);await expect(page.locator('#demo-badge')).toBeHidden();await expect(page.locator('#score')).toHaveText('0');
});
