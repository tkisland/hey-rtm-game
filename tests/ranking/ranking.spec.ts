import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import type {Page} from '@playwright/test';
import {api} from '../browser/mock-video';

test.beforeEach(async({page})=>{
  const container=process.env.RANKING_DB_CONTAINER;
  if(!container)throw new Error('Run npm run test:ranking to prepare isolated PHP/MySQL services.');
  execFileSync('docker',['exec','-i','--env','MYSQL_PWD=rhythm_root_pass',container,'mysql','-uroot','rhythm'],{input:'TRUNCATE TABLE rhythm_entries;TRUNCATE TABLE rhythm_sessions;TRUNCATE TABLE rhythm_rate_limits;'});
  await page.clock.install({time:new Date('2026-10-27T00:00:00Z')});await page.clock.pauseAt(new Date('2026-10-27T00:00:01Z'));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
  await page.route('https://firestore.googleapis.com/**',r=>r.fulfill({status:404,body:'{}'}));
  await page.addInitScript(()=>{
    localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false}));
    localStorage.setItem('hey-rhythm-onboarding-v1',JSON.stringify({seen:true,tutorial:true,timing:true}));
  });
  const start=page.waitForResponse(response=>response.url().includes('action=start'));
  await page.goto('./game.html');await page.clock.runFor(100);await expect(page.locator('#restart')).toBeEnabled();
  expect((await start).status()).toBe(200);
});
async function finish(page:Page,hit=true){
  await page.locator('#play-start').click();await page.clock.runFor(7650);
  if(hit)await page.keyboard.press('l');
  await page.clock.fastForward(210000);await page.clock.runFor(1700);
  await expect(page.locator('#result')).toBeVisible();await expect(page.locator('#ranking-form')).toBeVisible();
}
test('registers each play without login, preserves duplicate names and opens the correct board from the menu',async({page})=>{
  const during:string[]=[];page.on('request',request=>{if(request.url().includes('/api/'))during.push(request.url());});
  await page.locator('#play-start').click();await page.clock.runFor(7650);await page.keyboard.press('l');
  expect(during).toEqual([]);await page.clock.fastForward(210000);await page.clock.runFor(1700);
  await expect(page.locator('#ranking-form')).toBeVisible();await expect(page.locator('#result-score')).toHaveText('1,968');
  await page.locator('#ranking-name').fill('あいうえお');await page.locator('#ranking-submit').click();
  await expect(page.locator('#ranking-status')).toContainText('半角英数字3〜6文字');
  await page.locator('#ranking-name').fill('abc');await page.locator('#ranking-submit').click();
  await expect(page.locator('#ranking-status')).toContainText('ABC で登録しました！ 1位');
  await expect(page.locator('#ranking-entries')).toContainText('1,968 / COMBO 1');await expect(page.locator('#ranking-submit')).toBeDisabled();
  const next=page.waitForResponse(response=>response.url().includes('action=start'));
  await page.locator('#result-replay').click();await page.clock.runFor(32);await next;
  await page.clock.fastForward(220000);await page.clock.runFor(1700);
  await expect(page.locator('#ranking-name')).toHaveValue('');await expect(page.locator('#ranking-form')).toBeVisible();
  await page.locator('#ranking-name').fill('ABC');await page.locator('#ranking-submit').click();
  await expect(page.locator('#ranking-status')).toContainText('2位');await expect(page.locator('#ranking-entries li')).toHaveCount(2);
  if(test.info().project.name==='mobile-touch')await page.screenshot({path:test.info().outputPath('result-ranking.png')});
  await page.goto('./');await page.getByRole('link',{name:'ランキング',exact:true}).click();
  await expect(page.locator('#ranking-page-entries li')).toHaveCount(2);
  await page.locator('#ranking-difficulty').selectOption('hard');await expect(page.locator('#ranking-page-status')).toContainText('準備中');
  await expect(page.locator('#ranking-play')).toBeHidden();
  await expect(page.locator('#ranking-page-entries li')).toHaveCount(0);
  await page.locator('#ranking-song').selectOption('biscuit-case');await page.locator('#ranking-difficulty').selectOption('normal');
  await expect(page.locator('#ranking-page-status')).toContainText('まだ記録がありません');
  await expect(page.locator('#ranking-play')).toHaveAttribute('href','./game.html?song=biscuit-case');
});
test('registration stays visible without scrolling on 360x640 and 390x844 phones',async({page})=>{
  await page.route('**/api/ranking.php?action=leaderboard**',r=>r.fulfill({json:{ok:true,entries:Array.from({length:20},(_,i)=>({id:String(i+1),name:'PLAYER',score:1000000,maxCombo:510,createdAt:1}))}}));
  await finish(page);
  for(const viewport of [{width:360,height:640},{width:390,height:844}]) {
    await page.setViewportSize(viewport);await page.clock.runFor(32);
    await expect(page.locator('#ranking-title')).toHaveText('ランキング登録');
    expect(await page.locator('.ranking-board').getAttribute('open')).toBeNull();
    const fit=await page.evaluate(()=>{
      const panel=document.getElementById('result')!,form=document.getElementById('ranking-form')!,button=document.getElementById('ranking-submit')!;
      const bounds=button.getBoundingClientRect(),field=form.getBoundingClientRect();
      return {scroll:panel.scrollTop,overflow:panel.scrollHeight-panel.clientHeight,visible:bounds.bottom<=innerHeight&&field.top>=0,reachable:document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2)===button};
    });
    expect(fit.scroll).toBe(0);expect(fit.overflow).toBeLessThanOrEqual(1);expect(fit.visible).toBe(true);expect(fit.reachable).toBe(true);
  }
});
test('a lost registration response can be retried without creating another record',async({page})=>{
  await finish(page);let first=true;
  await page.route('**/api/ranking.php?action=submit',async route=>{
    if(first){first=false;await route.fetch();await route.abort('failed');}else await route.continue();
  });
  await page.locator('#ranking-name').fill('RETRY1');await page.locator('#ranking-submit').click();
  await expect(page.locator('#ranking-status')).toContainText('接続できません');await expect(page.locator('#ranking-submit')).toBeEnabled();
  await page.locator('#ranking-submit').click();await expect(page.locator('#ranking-status')).toContainText('1位');
  await expect(page.locator('#ranking-entries li')).toHaveCount(1);
});
test('seeks and speed changes keep the result playable but ineligible for registration',async({page})=>{
  await page.locator('#play-start').click();await page.clock.runFor(1000);
  await page.evaluate(()=>(window as any).testVideo.seekTo(100));await page.clock.runFor(32);
  await page.clock.fastForward(130000);await page.clock.runFor(1700);
  await expect(page.locator('#ranking-status')).toContainText('シークしたプレイは登録できません');
  await expect(page.locator('#ranking-form')).not.toBeVisible();await expect(page.locator('#result-replay')).toBeEnabled();
  const next=page.waitForResponse(response=>response.url().includes('action=start'));
  await page.locator('#result-replay').click();await page.clock.runFor(32);await next;
  await page.evaluate(()=>(window as any).testVideo.setPlaybackRate(.5));await page.clock.runFor(32);
  await page.evaluate(()=>(window as any).testVideo.setPlaybackRate(1));await page.clock.runFor(32);
  await page.clock.fastForward(220000);await page.clock.runFor(1700);
  await expect(page.locator('#ranking-status')).toContainText('再生速度を変更したプレイは登録できません');
  await expect(page.locator('#ranking-form')).not.toBeVisible();
});
test('a delayed response from the previous play cannot fill or lock the next registration form',async({page})=>{
  await finish(page);
  let release!:()=>void,committed!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve;}),saved=new Promise<void>(resolve=>{committed=resolve;});
  await page.route('**/api/ranking.php?action=submit',async route=>{
    const response=await route.fetch();committed();await waiting;await route.fulfill({response});
  });
  await page.locator('#ranking-name').fill('OLDER1');await page.locator('#ranking-submit').click();await saved;
  const start=page.waitForResponse(response=>response.url().includes('action=start'));
  await page.locator('#result-replay').click();await page.clock.runFor(32);await start;
  const oldResponse=page.waitForResponse(response=>response.url().includes('action=submit'));release();await oldResponse;
  await page.clock.runFor(32);await expect(page.locator('#ranking-name')).toHaveValue('');
  await page.clock.fastForward(220000);await page.clock.runFor(1700);
  await expect(page.locator('#ranking-form')).toBeVisible();await expect(page.locator('#ranking-name')).toHaveValue('');
  await expect(page.locator('#ranking-submit')).toBeEnabled();await expect(page.locator('#ranking-status')).not.toContainText('登録しました');
  await expect(page.locator('#ranking-entries')).toContainText('OLDER1');
});
