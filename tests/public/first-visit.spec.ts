import {test,expect} from '@playwright/test';
import {api} from '../browser/mock-video';
const key='hey-rhythm-onboarding-v1';
test.use({storageState:{cookies:[],origins:[]}});
test.beforeEach(async({page})=>{
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
});

test('first visit prompts once without media, skip leaves a resumable checklist and keeps play available',async({page})=>{
  const requests:string[]=[];page.on('request',r=>{if(r.url().includes('youtube.com'))requests.push(r.url());});
  await page.goto('/');await expect(page.locator('#onboarding')).toBeVisible();
  await expect(page.locator('#onboarding-title')).toBeFocused();
  await expect(page.locator('#onboarding-tutorial-status')).toHaveText('未確認');
  expect(requests).toEqual([]);
  await page.locator('#onboarding-later').click();await expect(page.locator('#onboarding')).not.toBeVisible();
  await expect(page.locator('#onboarding-resume')).toBeFocused();
  await page.reload();await expect(page.locator('#onboarding')).not.toBeVisible();
  await expect(page.locator('#onboarding-reminder')).toBeVisible();
  await page.locator('#onboarding-resume').click();await expect(page.locator('#onboarding')).toBeVisible();
  await page.keyboard.press('Escape');await page.locator('.song-play').first().click();
  await expect(page).toHaveURL(/game\.html/);
});

test('opening and skipping tutorial pages is not completion and retains the pending reminder',async({page})=>{
  await page.goto('/');await page.locator('#onboarding-tutorial').click();
  await expect(page.locator('#tutorial')).toBeVisible();await expect(page.locator('#onboarding')).not.toBeVisible();
  for(let i=0;i<6;i++)await page.locator('#tutorial-next').click();
  await expect(page.locator('#tutorial')).not.toBeVisible();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key)).toMatchObject({seen:true,tutorial:false,timing:false});
  await page.locator('#onboarding-resume').click();await expect(page.locator('#onboarding-tutorial-status')).toHaveText('未確認');
});

test('all six rehearsals lead to timing check, watched-and-saved alignment completes setup and survives reload',async({page})=>{
  await page.clock.install();
  await page.goto('/');await page.locator('#onboarding-tutorial').click();
  await page.locator('#tutorial-sound').setChecked(false);
  for(let i=0;i<6;i++) {
    await page.locator('#tutorial-start').click();
    await expect(page.locator('#tutorial-start')).toHaveText('もう一度');
    await page.clock.runFor(15000);
    await expect(page.locator('#tutorial-status')).toHaveText('練習終了');
    if(i<5)await page.locator('#tutorial-next').click();
  }
  await expect(page.locator('#tutorial-next')).toHaveText('タイミングをチェック');
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key)).toMatchObject({tutorial:true,timing:false});
  await page.locator('#tutorial-next').click();await expect(page.locator('#song-timing-start')).toBeEnabled();
  // Saving without observing a cue does not check off timing.
  await page.locator('#song-timing-close').click();await page.locator('#settings-close').click();
  await page.locator('#onboarding-resume').click();await expect(page.locator('#onboarding-tutorial-status')).toHaveText('✓ 確認済み');
  await page.locator('#onboarding-timing').click();await expect(page.locator('#song-timing-start')).toBeEnabled();
  await page.locator('#song-timing-start').click();
  await page.evaluate(()=>{const v=(window as any).testVideo;v.liveClock=false;v.seekTo(6);});
  await page.clock.runFor(100);
  await page.locator('#song-timing-apply').click();
  await expect(page.locator('.song-timing-preview')).not.toBeVisible();await expect(page.locator('#settings-panel')).not.toBeVisible();
  await expect(page.locator('.onboarding-ready')).toHaveText('準備OK！曲を選んで遊ぼう。');
  await expect(page.locator('#onboarding-reminder')).not.toBeVisible();
  await page.reload();await expect(page.locator('#onboarding')).not.toBeVisible();await expect(page.locator('#onboarding-reminder')).not.toBeVisible();
  await page.locator('#settings-toggle').click();await expect(page.locator('#settings-panel')).toBeVisible();
});

test('timing can be checked first; unopened cues and cancellation never check it off',async({page})=>{
  await page.goto('/');await page.locator('#onboarding-timing').click();await expect(page.locator('#song-timing-start')).toBeEnabled();
  await page.locator('#song-timing-apply').click();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key)).toMatchObject({timing:false,tutorial:false});
  await page.locator('#song-calibrate').click();await expect(page.locator('#song-timing-start')).toBeEnabled();
  await page.locator('#song-timing-start').click();
  await page.evaluate(async()=>{const v=(window as any).testVideo;v.liveClock=false;v.seekTo(6);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  await page.locator('#song-timing-close').click();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key)).toMatchObject({timing:false});
  await page.locator('#song-calibrate').click();await expect(page.locator('#song-timing-start')).toBeEnabled();
  await page.locator('#song-timing-start').click();
  await page.evaluate(async()=>{const v=(window as any).testVideo;v.liveClock=false;v.seekTo(6);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  await page.locator('#song-timing-apply').click();await expect(page.locator('#settings-panel')).not.toBeVisible();
  await page.locator('#onboarding-resume').click();await expect(page.locator('#onboarding-timing-status')).toHaveText('✓ 確認済み');
  await expect(page.locator('#onboarding-tutorial-status')).toHaveText('未確認');
});

test('storage failures and small viewports preserve escape and access to play',async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.setItem=()=>{throw new Error('blocked');};});
  await page.goto('/');await expect(page.locator('#onboarding-storage')).toContainText('保存できません');
  for(const [width,height] of [[320,480],[390,844],[844,390]]) {
    await page.setViewportSize({width,height});
    await expect.poll(()=>page.locator('#onboarding').evaluate(d=>d.scrollWidth<=d.clientWidth+1)).toBe(true);
    await page.locator('#onboarding-later').scrollIntoViewIfNeeded();await expect(page.locator('#onboarding-later')).toBeInViewport();
  }
  await page.keyboard.press('Escape');await page.locator('#settings-toggle').click();await expect(page.locator('#settings-panel')).toBeVisible();
});

test('timing confirmed inside the game is recognized when returning to song selection',async({page})=>{
  await page.addInitScript(()=>{if(!localStorage.getItem('hey-rhythm-onboarding-v1'))localStorage.setItem('hey-rhythm-onboarding-v1',JSON.stringify({seen:true,tutorial:true,timing:false}));});
  await page.goto('/game.html');await expect(page.locator('#restart')).toBeEnabled();
  await page.locator('#settings-toggle').click();await page.locator('#song-calibrate').click();await expect(page.locator('#song-timing-start')).toBeEnabled();
  await page.locator('#song-timing-start').click();
  await page.evaluate(async()=>{const v=(window as any).testVideo;v.liveClock=false;v.seekTo(6);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  await page.locator('#song-timing-apply').click();
  expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key)).toMatchObject({tutorial:true,timing:true});
  await page.goto('/');await expect(page.locator('#onboarding')).not.toBeVisible();await expect(page.locator('#onboarding-reminder')).not.toBeVisible();
});
