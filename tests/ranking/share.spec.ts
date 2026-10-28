import {test,expect} from '@playwright/test';

test('the shared result has static crawler metadata, an actual score PNG and a playable song link',async({page})=>{
  const query=new URLSearchParams({song:'biscuit-case',difficulty:'normal',v:'4',score:'1160000',base:'960000',combo:'328',skipped:'0'});
  await page.goto(`./share.php?${query}`);
  await expect(page.locator('h1')).toHaveText('最高なLIVE！');
  await expect(page.getByRole('link',{name:'この曲で遊ぶ'})).toHaveAttribute('href','./game.html?song=biscuit-case&difficulty=normal');
  expect(await page.locator('meta[property="og:image"]').getAttribute('content')).toContain('https://hey.jpn.org/rhythm/share-image.php?');
  expect(await page.locator('img').evaluate((img:HTMLImageElement)=>({loaded:img.complete,width:img.naturalWidth,height:img.naturalHeight}))).toEqual({loaded:true,width:1200,height:630});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(test.info().project.name==='mobile-touch')await page.screenshot({path:test.info().outputPath('result-share.png')});
});
