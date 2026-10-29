import {test,expect} from '@playwright/test';
import {api} from '../browser/mock-video';

test('a completed play shares a stored anonymous result with static metadata and an actual cached PNG',async({page})=>{
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://firestore.googleapis.com/**',r=>r.fulfill({status:404,body:'{}'}));
  await page.addInitScript(()=>{
    localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false}));
    localStorage.setItem('hey-rhythm-onboarding-v1',JSON.stringify({seen:true,tutorial:true,timing:true}));
  });
  await page.goto('./game.html');await expect.poll(()=>page.evaluate(()=>Boolean((window as any).testVideo))).toBe(true);await page.clock.runFor(100);
  await page.locator('#play-start').click();await page.clock.runFor(7650);await page.keyboard.press('l');
  await page.clock.fastForward(210000);await page.clock.runFor(1700);
  await expect.poll(()=>page.locator('#result-share').getAttribute('href')).toContain('id%3D');
  const shared=new URL(new URL((await page.locator('#result-share').getAttribute('href'))!).searchParams.get('text')!.split('\n').at(-1)!);
  const id=shared.searchParams.get('id');expect(id).toMatch(/^[a-f0-9]{32}$/);expect([...shared.searchParams.keys()]).toEqual(['id']);
  await page.goto(`./share.php?id=${id}`);
  await expect(page.locator('h1')).toHaveText('また一緒にLIVEしよう！');
  await expect(page.getByRole('link',{name:'この曲で遊ぶ'})).toHaveAttribute('href','./game.html?song=super-mommy-girls&difficulty=normal');
  expect(await page.locator('body').innerText()).not.toMatch(/テスト版|試作|プロトタイプ/);
  await expect(page.locator('body')).toContainText('TOTAL 1,968 · MAX COMBO 1');
  const imageUrl=new URL((await page.locator('meta[property="og:image"]').getAttribute('content'))!);
  expect(imageUrl.searchParams.get('art')).toBe('4');expect(imageUrl.searchParams.get('id')).toBe(id);
  expect(await page.locator('img').evaluate((img:HTMLImageElement)=>({loaded:img.complete,width:img.naturalWidth,height:img.naturalHeight}))).toEqual({loaded:true,width:1200,height:630});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(test.info().project.name==='mobile-touch')await page.screenshot({path:test.info().outputPath('verified-share.png')});
});
test('old numeric links remain playable but cannot render their claimed scores',async({page})=>{
  await page.goto('./share.php?song=biscuit-case&difficulty=normal&score=2147483647');
  await expect(page.locator('body')).not.toContainText('2,147,483,647');
  await expect(page.locator('body')).toContainText('以前の形式');
  await expect(page.locator('img')).toHaveAttribute('src','./ogp-v2.png');
  await expect(page.getByRole('link',{name:'この曲で遊ぶ'})).toHaveAttribute('href','./game.html?song=biscuit-case&difficulty=normal');
});
