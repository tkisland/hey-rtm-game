import {test,expect} from '@playwright/test';
import {api,seekPlay} from '../browser/mock-video';

test.beforeEach(async({page})=>{
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
  await page.goto('/game.html');
  await expect(page.locator('#restart')).toBeEnabled();
});

test('built concert keeps the complete monitor exposed and thumb pads clear on portrait, desktop and landscape screens',async({page})=>{
  for(const [width,height] of [[320,480],[360,640],[390,740],[390,844],[428,926],[1280,900],[640,360],[844,390]]) {
    await page.setViewportSize({width,height});
    await expect.poll(()=>page.evaluate(()=>{
      const iframe=document.querySelector('iframe')!,v=iframe.getBoundingClientRect();
      const field=document.querySelector('#game-canvas')!.getBoundingClientRect();
      const panel=document.querySelector('.media-panel')!.getBoundingClientRect();
      const clear=[[1,1],[v.width-1,1],[1,v.height-1],[v.width-1,v.height-1],[v.width/2,v.height/2]]
        .every(([x,y])=>document.elementFromPoint(v.left+x,v.top+y)===iframe);
      const pads=[...document.querySelectorAll('.lane-button')].map(p=>p.getBoundingClientRect());
      const portrait=innerHeight>=innerWidth;
      return v.width>=200&&v.height>=200&&v.top>=0&&v.bottom<=innerHeight&&clear&&
        (portrait ? Math.abs(panel.bottom-field.top)<.5&&Math.abs(field.top-v.bottom-4)<.5 : v.right<=field.left||v.bottom<=field.top)&&
        pads.every(p=>p.width>=44&&Math.abs(p.width-pads[0].width)<.1&&p.height>=60&&p.bottom<=innerHeight-43.9)&&
        field.bottom<=innerHeight+.5&&document.documentElement.scrollWidth<=innerWidth;
    })).toBe(true);
  }
});

test('opening details and hitting the penlights leaves the monitor and runway fixed',async({page})=>{
  const video=await page.locator('iframe').boundingBox(),field=await page.locator('#game-canvas').boundingBox();
  await page.locator('.playback-details summary').click();
  await expect(page.locator('.playback-info a')).toBeVisible();
  expect(await page.locator('iframe').boundingBox()).toEqual(video);
  expect(await page.locator('#game-canvas').boundingBox()).toEqual(field);
  await page.locator('.playback-details summary').click();
  await seekPlay(page,12);
  for (const lane of [2,3,0,5]) await page.locator('.lane-button').nth(lane).click();
  expect(await page.locator('iframe').boundingBox()).toEqual(video);
  expect(await page.locator('#game-canvas').boundingBox()).toEqual(field);
});
