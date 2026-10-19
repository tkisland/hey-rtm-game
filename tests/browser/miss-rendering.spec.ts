import {test,expect} from '@playwright/test';
import {api} from './mock-video';

test('unattended dense notes do not restart MISS animations or rewrite unchanged score and labels',async({page})=>{
  await page.clock.install({time:new Date('2026-10-19T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-19T00:00:01Z'));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
  await page.addInitScript(()=>{
    localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false}));
    localStorage.setItem('hey-rhythm-custom-chart-v1',JSON.stringify({videoId:'pJDfWpZ7CI4',title:'dense misses',bpm:200,startTime:2,
      notes:[...Array.from({length:100},(_,i)=>({id:i+1,time:2+Math.floor(i/5)*.15,lane:i%5,type:'tap'})),{id:101,time:6,lane:5,type:'tap'}]}));
  });
  await page.goto('/game.html?chart=custom');await page.clock.runFor(100);await expect(page.locator('#restart')).toBeEnabled();
  const geometry=await page.locator('#game-canvas').boundingBox();
  await page.evaluate(()=>{
    const state=(window as any).missWork={animations:0,labels:0,score:0,motion:[] as {at:number;y:number}[]};
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(...args){if(this.classList.contains('lane-judgement'))state.animations++;return animate.apply(this,args);};
    const labels=new MutationObserver(records=>state.labels+=records.length);
    document.querySelectorAll('.judgement-label').forEach(label=>labels.observe(label,{childList:true,characterData:true,subtree:true}));
    const score=new MutationObserver(records=>state.score+=records.length);
    ['score','combo','max-combo'].forEach(id=>score.observe(document.getElementById(id)!,{childList:true,characterData:true,subtree:true}));
    const round=CanvasRenderingContext2D.prototype.roundRect;
    CanvasRenderingContext2D.prototype.roundRect=function(...args){
      // Only the yellow sentinel moves while the other five lanes repeatedly MISS.
      if(this.canvas.id==='game-canvas'&&this.fillStyle==='#ffe779')state.motion.push({at:performance.now(),y:args[1]+args[3]/2});
      return round.apply(this,args);
    };
    (window as any).testVideo.playVideo();
  });
  await page.clock.runFor(5500);
  const work=await page.evaluate(()=>(window as any).missWork as {animations:number;labels:number;score:number;motion:{at:number;y:number}[]});
  expect(work.animations).toBe(0);expect(work.labels).toBe(5);expect(work.score).toBe(0);
  expect(work.motion.length).toBeGreaterThan(80);
  for(let i=1;i<work.motion.length;i++){
    const previous=work.motion[i-1],current=work.motion[i];
    expect(current.y).toBeGreaterThan(previous.y);
    expect(current.at-previous.at).toBeLessThanOrEqual(17);
  }
  expect(await page.locator('#game-canvas').boundingBox()).toEqual(geometry);
  await expect(page.locator('#judgement-0 .judgement-label')).toHaveText('MISS');
  await expect(page.locator('#judgement-0')).toBeVisible();
  await page.clock.runFor(400);
  await expect(page.locator('#judgement-0')).not.toBeVisible(); // Last MISS still expires after 800ms.
  await page.clock.runFor(1900);
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#result-counts div').filter({hasText:'MISS'}).locator('strong')).toHaveText('101');
  await expect(page.locator('#result-score')).toHaveText('0');
});
