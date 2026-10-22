import {test,expect} from '@playwright/test';
import {api} from './mock-video';

test.beforeEach(async({page})=>{
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
  await page.addInitScript(()=>{
    localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false}));
    localStorage.setItem('hey-rhythm-custom-chart-v1',JSON.stringify({videoId:'pJDfWpZ7CI4',title:'repeat hits',bpm:200,startTime:2,
      notes:Array.from({length:24},(_,i)=>({id:i+1,time:2+i*.3,lane:i%6,type:'tap'}))}));
  });
});

test('success feedback reuses six animations while repeated notes keep scoring and MISS cancels the pop',async({page})=>{
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  await page.goto('/game.html?chart=custom');await page.clock.runFor(100);await expect(page.locator('#restart')).toBeEnabled();
  await page.evaluate(()=>{
    (window as any).feedbackCreated=0;
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(...args){if(this.classList.contains('lane-judgement'))(window as any).feedbackCreated++;return animate.apply(this,args);};
    const video=(window as any).testVideo;video.seekTo(2);video.playVideo();
  });
  for(let i=0;i<24;i++){
    if(i)await page.clock.runFor(300);else await page.clock.runFor(16);
    await page.keyboard.press(['s','d','f','j','k','l'][i%6]);
  }
  await expect(page.locator('#score')).toHaveText('24,000');
  expect(await page.evaluate(()=>(window as any).feedbackCreated)).toBe(6);
  await page.clock.runFor(1000);
  expect(await page.locator('.lane-judgement').evaluateAll(nodes=>nodes.flatMap(node=>node.getAnimations()).filter(animation=>animation.playState==='running').length)).toBe(0);
  // Cancelled animations are also reusable on an explicit restart.
  await page.locator('#restart').click();await page.clock.runFor(2016);await page.keyboard.press('s');
  await expect(page.locator('#score')).toHaveText('1,000');
  expect(await page.evaluate(()=>(window as any).feedbackCreated)).toBe(6);
  // Let the next lane MISS, then its reused pop must be cancelled immediately.
  await page.clock.runFor(600);
  await expect(page.locator('#judgement-1 .judgement-label')).toHaveText('MISS');
  expect(await page.locator('#judgement-1').evaluate(node=>node.getAnimations().length)).toBe(0);
});

test('pointer movement reuses pad geometry and refreshes it on viewport changes and the next gesture',async({page})=>{
  await page.goto('/game.html?chart=custom');await expect(page.locator('#restart')).toBeEnabled();
  const buttons=page.locator('.lane-button');
  const first=(await buttons.nth(0).boundingBox())!,last=(await buttons.nth(5).boundingBox())!;
  await page.evaluate(()=>{
    (window as any).padReads=0;
    document.querySelectorAll('.lane-button').forEach(button=>{
      const read=button.getBoundingClientRect.bind(button);
      button.getBoundingClientRect=()=>{(window as any).padReads++;return read();};
    });
  });
  const y=first.y+first.height/2;
  await page.mouse.move(first.x+first.width/2,y);await page.mouse.down();
  await page.mouse.move(last.x+last.width/2,y,{steps:24});
  await expect(buttons.nth(5)).toHaveClass(/pressed/);
  expect(await page.evaluate(()=>(window as any).padReads)).toBe(6);
  // Simulate a viewport notification without moving the finger or changing targets.
  await page.evaluate(()=>window.dispatchEvent(new Event('resize')));
  await page.mouse.move(first.x+first.width/2,y,{steps:24});
  await expect(buttons.nth(0)).toHaveClass(/pressed/);
  expect(await page.evaluate(()=>(window as any).padReads)).toBe(12);
  await page.mouse.up();await page.mouse.down();
  await page.mouse.move(last.x+last.width/2,y,{steps:24});await page.mouse.up();
  expect(await page.evaluate(()=>(window as any).padReads)).toBe(18);
  await expect(page.locator('.lane-button.pressed')).toHaveCount(0);
});
