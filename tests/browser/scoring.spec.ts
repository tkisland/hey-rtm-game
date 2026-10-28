import {test,expect} from '@playwright/test';
import {api} from './mock-video';

test('the result displays base, both bonuses and their total, and replay clears all three',async({page})=>{
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
  await page.addInitScript(()=>{
    localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false}));
    localStorage.setItem('hey-rhythm-custom-chart-v1',JSON.stringify({videoId:'pJDfWpZ7CI4',title:'Score breakdown',bpm:120,startTime:2,notes:[
      ...Array.from({length:20},(_,i)=>({id:i+1,type:'tap',lane:i%6,time:2+i*.3})),
      {id:21,type:'hold',lane:0,time:8,endTime:10},
      {id:22,type:'tap',gimmick:'dd',lane:2,time:11},
    ]}));
  });
  await page.goto('/game.html?chart=custom');await page.clock.runFor(100);await expect(page.locator('#restart')).toBeEnabled();
  await expect(page.locator('#chart-info')).toContainText('22 NOTES');
  await page.evaluate(()=>{const v=(window as any).testVideo;v.seekTo(2);v.playVideo();});
  await page.clock.runFor(16);
  for(let i=0;i<20;i++){
    if(i)await page.clock.runFor(300);
    await page.keyboard.press('sdfjkl'[i%6]);
  }
  await page.clock.runFor(300);await page.keyboard.down('s');
  await page.clock.runFor(2000);await page.keyboard.up('s');
  await page.clock.runFor(1000);await page.keyboard.press('l');
  await page.clock.runFor(1700);
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result-message')).toHaveText('伝説のLIVE！');
  await expect(page.locator('#result-base-score')).toHaveText('1,000,000');
  await expect(page.locator('#result-combo-bonus')).toHaveText('＋10,909');
  await expect(page.locator('#result-special-bonus')).toHaveText('＋1,050');
  await expect(page.locator('#result-score')).toHaveText('1,011,959');
  await expect(page.locator('#result-accuracy')).toContainText('100.0%');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(test.info().project.name==='mobile-touch')await page.screenshot({path:test.info().outputPath('score-breakdown.png')});
  await page.locator('.score-help summary').click();await expect(page.locator('.score-help')).toContainText('100コンボ以上は15％');
  await page.locator('#result-replay').click();await page.clock.runFor(32);
  await expect(page.locator('#score')).toHaveText('0');await expect(page.locator('#result')).not.toBeVisible();
  await page.clock.runFor(14000);
  await expect(page.locator('#result-message')).toHaveText('また一緒にLIVEしよう！');
  expect(await page.locator('.score-help').getAttribute('open')).toBeNull();
  for(const id of ['result-base-score','result-score'])await expect(page.locator(`#${id}`)).toHaveText('0');
  for(const id of ['result-combo-bonus','result-special-bonus'])await expect(page.locator(`#${id}`)).toHaveText('＋0');
});
