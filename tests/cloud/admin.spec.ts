import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { api, seekPlay } from '../browser/mock-video';

const base='http://127.0.0.1:8080',documents=`${base}/v1/projects/demo-hey-rtm/databases/(default)/documents`;
const chart={videoId:'pJDfWpZ7CI4',title:'Online test',bpm:120,beatOrigin:12,startTime:12,notes:[{id:1,lane:0,type:'tap',time:12},{id:2,lane:5,type:'tap',time:12},{id:3,lane:2,type:'hold',time:13,endTime:14}]};
async function role(uid:string, enabled=true) {
  const response=await fetch(`${documents}/admins/${encodeURIComponent(uid)}`,{method:'PATCH',headers:{'content-type':'application/json',authorization:'Bearer owner'},body:JSON.stringify({fields:{enabled:{booleanValue:enabled}}})});
  expect(response.ok).toBe(true);
}
async function signIn(page:Page, grant=true) {
  const email=`admin-${crypto.randomUUID()}@example.test`;
  const uid=await page.evaluate(async email => (await import('/tests/cloud/auth-browser-fixture.ts')).signInGoogle(email),email);
  if (grant) {await role(uid);await expect(page.locator('#record-toggle')).toBeEnabled();}
  return uid;
}
async function importChart(page:Page, data:unknown=chart) {
  await page.locator('#import-chart').setInputFiles({name:'online.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await expect(page.locator('#note-count')).toHaveText(`${(data as typeof chart).notes.length} NOTES`);
}
test.beforeEach(async ({page}) => {
  const response=await fetch(`${base}/emulator/v1/projects/demo-hey-rtm/databases/(default)/documents`,{method:'DELETE'});expect(response.ok).toBe(true);
  await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
  await page.goto('/admin.html');await expect(page.locator('#google-login')).toBeEnabled();
});
test('uses the Google sign-in button and popup before checking the administrator role',async ({page})=>{
  test.skip(process.env.RUN_GOOGLE_NETWORK !== '1','Requires the real Google helper at apis.google.com; the cloud network returns CONNECT 403. Set RUN_GOOGLE_NETWORK=1 where Google is reachable.');
  const popupPromise=page.waitForEvent('popup');await page.locator('#google-login').click();const popup=await popupPromise;
  await expect(popup).toHaveURL(/127\.0\.0\.1:9099\/emulator\/auth\/handler/);
  await popup.getByText('Add new account',{exact:false}).click();
  await popup.locator('#email-input').fill(`popup-${crypto.randomUUID()}@example.test`);
  await popup.locator('#display-name-input').fill('Popup test');
  await popup.locator('#sign-in').click();
  await expect(page.locator('#login-status')).toContainText('編集権限がありません');
  await expect(page.locator('#record-toggle')).toHaveCount(0);
});
test('edits, saves, previews and publishes each difficulty without touching normal or exposing drafts',async({page,browser})=>{
  await signIn(page);await importChart(page);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#cloud-publish').click();await expect(page.locator('#cloud-status')).toContainText('公開しました');
  await page.locator('#admin-difficulty').selectOption('easy');await expect(page.locator('#note-count')).toHaveText('0 NOTES');
  await importChart(page,{...chart,notes:[chart.notes[0]]});
  await page.locator('#cloud-save').click();await expect(page.locator('#cloud-status')).toContainText('版 1');
  await page.locator('#try-game').click();await expect(page).toHaveURL(/difficulty=easy.*preview=1/);
  await expect(page.locator('#chart-info')).toContainText('1 NOTES');
  await page.getByRole('link',{name:'管理画面へ戻る'}).click();await expect(page.locator('#admin-difficulty')).toHaveValue('easy');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#cloud-publish').click();await expect(page.locator('#cloud-status')).toContainText('公開しました');
  await page.locator('#admin-difficulty').selectOption('hard');await expect(page.locator('#note-count')).toHaveText('0 NOTES');
  await importChart(page,{...chart,notes:chart.notes.slice(0,2)});
  await page.locator('#cloud-save').click();await expect(page.locator('#cloud-status')).toContainText('版 1');
  await page.locator('#admin-difficulty').selectOption('normal');await expect(page.locator('#note-count')).toHaveText('3 NOTES');
  await page.locator('#admin-difficulty').selectOption('easy');await expect(page.locator('#note-count')).toHaveText('1 NOTES');
  await importChart(page,{...chart,notes:chart.notes.slice(0,2)});
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#admin-difficulty').selectOption('hard');
  await expect(page.locator('#admin-difficulty')).toHaveValue('easy');await expect(page.locator('#note-count')).toHaveText('2 NOTES');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#admin-difficulty').selectOption('normal');await expect(page.locator('#note-count')).toHaveText('3 NOTES');
  await page.locator('#admin-difficulty').selectOption('easy');await expect(page.locator('#note-count')).toHaveText('1 NOTES');
  const context=await browser.newContext(),player=await context.newPage();
  await player.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
  await player.addInitScript(()=>localStorage.setItem('hey-rhythm-onboarding-v1',JSON.stringify({seen:true,tutorial:true,timing:true})));
  await player.goto('http://127.0.0.1:4184/');
  const select=player.getByRole('combobox',{name:'SUPER MOMMY GIRLSの難易度'});
  await expect(select.locator('option[value="easy"]')).toHaveText('かんたん');
  await expect(select.locator('option[value="hard"]')).toHaveText('むずかしい（準備中）');
  await select.selectOption('easy');await player.locator('[data-song="super-mommy-girls"] .song-play').click();
  await expect(player.locator('#chart-info')).toContainText('1 NOTES');await expect(player.locator('#song-difficulty')).toHaveText('かんたん');
  await player.goto('http://127.0.0.1:4184/game.html');await expect(player.locator('#chart-info')).toContainText('3 NOTES');
  await player.goto('http://127.0.0.1:4184/game.html?difficulty=hard');await expect(player).toHaveURL(/unavailable-song=1/);
  await context.close();
});
test('keeps the editor and video unloaded until Google identity and server role both allow access',async ({page})=>{
  const requests:string[]=[];page.on('request',request=>requests.push(request.url()));
  await expect(page.locator('#record-toggle')).toHaveCount(0);
  const uid=await signIn(page,false);
  await expect(page.locator('#login-status')).toContainText('編集権限がありません');
  await expect(page.locator('#admin-account-id')).toContainText(uid);
  expect(requests.some(url=>url.includes('editor-controller')||url.includes('youtube.com'))).toBe(false);
  await role(uid);await expect(page.locator('#record-toggle')).toBeEnabled();
  await expect(page.locator('#note-count')).toHaveText('510 NOTES');
  expect(requests.some(url=>url.includes('editor-controller'))).toBe(true);
});
test('saves drafts privately, publishes explicitly, and serves the new chart to anonymous players',async ({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await signIn(page);await importChart(page);
  await page.locator('#cloud-save').click();await expect(page.locator('#cloud-status')).toContainText('下書きを保存しました');
  const playerContext=await browser.newContext(),player=await playerContext.newPage();
  await player.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
  await player.goto('http://127.0.0.1:4184/game.html');await expect(player.locator('#chart-info')).toContainText('510 NOTES');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#cloud-publish').click();await expect(page.locator('#cloud-status')).toContainText('公開しました');
  await player.reload();await expect(player.locator('#chart-info')).toContainText('3 NOTES');
  await seekPlay(player,12);await player.keyboard.down('s');await player.keyboard.down('l');await expect(player.locator('#combo')).toHaveText('2');
  await player.keyboard.up('s');await player.keyboard.up('l');
  await importChart(page,{...chart,notes:[...chart.notes,{id:4,lane:3,type:'tap',time:15}]});
  await page.locator('#cloud-save').click();await expect(page.locator('#cloud-status')).toContainText('版 2');
  await player.reload();await expect(player.locator('#chart-info')).toContainText('3 NOTES');
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#cloud-publish').click();
  await player.reload();await expect(player.locator('#chart-info')).toContainText('3 NOTES');
  await page.locator('#admin-logout').click();await expect(page.locator('#google-login')).toBeEnabled();await expect(page.locator('#record-toggle')).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin.html$/);
  await signIn(page);await expect(page.locator('#note-count')).toHaveText('4 NOTES');
  await expect(page.locator('#cloud-status')).toContainText('下書きの版 2');
  expect(errors).toEqual([]);await playerContext.close();
});
test('refuses stale saves and removes the editor when its administrator role is revoked',async ({page,browser})=>{
  const uid=await signIn(page);await importChart(page);await page.locator('#cloud-save').click();
  await expect(page.locator('#cloud-status')).toContainText('版 1');
  const secondContext=await browser.newContext(),second=await secondContext.newPage();
  await second.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
  await second.goto('http://127.0.0.1:4184/admin.html');await expect(second.locator('#google-login')).toBeEnabled();await signIn(second);
  await expect(second.locator('#note-count')).toHaveText('3 NOTES');
  await importChart(page,{...chart,notes:[...chart.notes,{id:4,lane:3,type:'tap',time:15}]});await page.locator('#cloud-save').click();await expect(page.locator('#cloud-status')).toContainText('版 2');
  await second.locator('#cloud-save').click();await expect(second.locator('#cloud-status')).toContainText('別の編集が保存されています');
  await expect(second.locator('#record-toggle')).toBeEnabled();
  await role(uid,false);await expect(page.locator('#record-toggle')).toHaveCount(0);await expect(page.locator('#login-status')).toContainText('編集権限がありません');
  await secondContext.close();
});
test('previews a saved draft without publishing and rejects anonymous preview access',async ({page,browser})=>{
  const rankingRequests:string[]=[];page.on('request',request=>{if(request.url().includes('/api/ranking.php'))rankingRequests.push(request.url());});
  await page.addInitScript(()=>localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false})));
  await signIn(page);await importChart(page);
  await page.locator('#try-game').click();await expect(page).toHaveURL(/game.html.*preview=1/);await expect(page.locator('#chart-info')).toContainText('3 NOTES');
  await expect(page.getByRole('link',{name:'管理画面へ戻る'})).toBeVisible();
  await page.evaluate(()=>{const video=(window as any).testVideo;video.seekTo(15);video.playVideo();video.setState(0);});
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result-share')).not.toBeVisible();
  await expect(page.locator('#result-ranking')).not.toBeVisible();expect(rankingRequests).toEqual([]);
  await expect(page.locator('#result-share')).not.toHaveAttribute('href',/.+/);
  const publicContext=await browser.newContext(),publicPage=await publicContext.newPage();
  await publicPage.goto('http://127.0.0.1:4184/game.html?preview=1');await expect(publicPage).toHaveURL(/admin.html/);await expect(publicPage.locator('#google-login')).toBeEnabled();
  await publicPage.goto('http://127.0.0.1:4184/game.html');await expect(publicPage.locator('#chart-info')).toContainText('510 NOTES');
  await publicContext.close();
});
test('discarded editor sessions cannot finish a delayed file import after revocation',async ({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const uid=await signIn(page);
  await page.evaluate(()=>{
    const original=File.prototype.text;
    File.prototype.text=function(){return new Promise(resolve=>{(window as any).releaseImport=async()=>resolve(await original.call(this));});};
  });
  await page.locator('#import-chart').setInputFiles({name:'pending.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(chart))});
  await page.waitForFunction(()=>Boolean((window as any).releaseImport));
  await role(uid,false);await expect(page.locator('#record-toggle')).toHaveCount(0);
  await page.evaluate(()=>(window as any).releaseImport());await page.waitForTimeout(100);
  await expect(page.locator('#login-status')).toContainText('編集権限がありません');expect(errors).toEqual([]);
});
