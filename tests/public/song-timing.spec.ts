import {test,expect} from '@playwright/test';
import {api} from '../browser/mock-video';

test.beforeEach(async({page})=>{
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
});
test('migrates existing alignment, previews MV without scoring, and saves each correction independently',async({page})=>{
  await page.addInitScript(()=>{if(!localStorage.getItem('hey-rhythm-settings-v1'))localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({inputOffset:100}));});
  await page.goto('/game.html');await expect(page.locator('#restart')).toBeEnabled();
  await page.locator('#play-start').click();
  await page.evaluate(()=>{const v=(window as any).testVideo;(window as any).mainVideo=v;v.liveClock=false;v.seekTo(7.75);v.playVideo();
    const c=document.getElementById('game-canvas')!;c.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyL',bubbles:true}));c.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyL',bubbles:true}));});
  await expect(page.locator('#score')).toHaveText('1,968');
  await page.locator('#settings-toggle').click();await page.locator('#song-calibrate').click();
  await expect(page.locator('#song-timing-start')).toBeEnabled();
  await expect(page.locator('#song-timing-offset')).toHaveValue('100');
  await page.locator('#song-timing-start').click();
  await page.locator('#song-timing-offset').fill('150');
  await expect(page.locator('#song-timing-offset-value')).toHaveText('+150 ms');
  await page.locator('#song-timing-apply').click();
  await expect(page.locator('#score')).toHaveText('1,968');
  await page.locator('#flow-calibrate').click();await expect(page.locator('#timing-preview-value')).toHaveText('0 ms');
  await page.locator('#timing-preview-offset').fill('80');await page.locator('#timing-preview-apply').click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!))).toMatchObject({noteOffset:150,inputOffset:80});
  await page.locator('#song-calibrate').click();await expect(page.locator('#song-timing-offset')).toHaveValue('150');
  await page.locator('#song-timing-offset').fill('-100');await page.locator('#song-timing-close').click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!))).toMatchObject({noteOffset:150,inputOffset:80});
  await page.locator('#settings-close').click();
  // Both corrections affect judgement, while the renderer uses only noteOffset.
  await page.evaluate(()=>{const v=(window as any).mainVideo;v.liveClock=false;v.seekTo(8.241445);v.playVideo();
    const c=document.getElementById('game-canvas')!;c.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyK',bubbles:true}));c.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyK',bubbles:true}));});
  await expect(page.locator('#judgement-4 .judgement-label')).toHaveText('PERFECT');
  await page.reload();await page.locator('#settings-toggle').click();await page.locator('#song-calibrate').click();
  await expect(page.locator('#song-timing-offset')).toHaveValue('150');
});
test('menu opens song preview without autoplay and keeps controls reachable',async({page})=>{
  await page.goto('/');await page.locator('#settings-toggle').click();await page.locator('#song-calibrate').click();
  await expect(page.locator('.song-timing-preview')).toBeVisible();await expect(page.locator('#song-timing-start')).toBeEnabled();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(()=>(window as any).testVideo.state)).not.toBe(1);
  await page.locator('#song-timing-offset').fill('100');await page.locator('#song-timing-apply').click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!))).toMatchObject({noteOffset:100,inputOffset:0});
});

test('input adjustment never moves actual game note geometry',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({noteOffset:100,inputOffset:0}));
    (window as any).gameHeads=[];
    const clear=CanvasRenderingContext2D.prototype.clearRect,round=CanvasRenderingContext2D.prototype.roundRect;
    CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.id==='game-canvas')(window as any).gameHeads=[];return clear.apply(this,args);};
    CanvasRenderingContext2D.prototype.roundRect=function(...args){if(this.canvas.id==='game-canvas')(window as any).gameHeads.push(args.slice(0,4));return round.apply(this,args);};
  });
  await page.goto('/game.html');await expect(page.locator('#restart')).toBeEnabled();
  await page.evaluate(()=>{const v=(window as any).testVideo;v.liveClock=false;v.seekTo(6.65);v.pauseVideo();});
  await expect.poll(()=>page.evaluate(()=>(window as any).gameHeads.length)).toBeGreaterThan(0);
  const before=await page.evaluate(()=>(window as any).gameHeads);
  await page.locator('#settings-toggle').click();await page.locator('#flow-calibrate').click();
  await page.locator('#timing-preview-offset').fill('150');await page.locator('#timing-preview-apply').click();
  await page.locator('#settings-close').click();
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  expect(await page.evaluate(()=>(window as any).gameHeads)).toEqual(before);
});

test('uses the dedicated video and numbered cue 1 reaches the line at 6s plus the candidate offset',async({page})=>{
  await page.goto('/game.html');await expect(page.locator('#restart')).toBeEnabled();
  await page.locator('#settings-toggle').click();await page.locator('#song-calibrate').click();
  await expect(page.locator('#song-timing-start')).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).testVideo.options.videoId)).toBe('SFqCNFPPqBE');
  await page.evaluate(()=>{
    (window as any).refArcs=[];(window as any).refLabels=[];
    const fill=CanvasRenderingContext2D.prototype.fillRect,arc=CanvasRenderingContext2D.prototype.arc,text=CanvasRenderingContext2D.prototype.fillText;
    const isRef=(ctx:CanvasRenderingContext2D)=>ctx.canvas===document.querySelector('.song-timing-field canvas');
    CanvasRenderingContext2D.prototype.fillRect=function(...args){if(isRef(this)&&args[0]===0&&args[1]===0){(window as any).refArcs=[];(window as any).refLabels=[];}return fill.apply(this,args);};
    CanvasRenderingContext2D.prototype.arc=function(...args){if(isRef(this))(window as any).refArcs.push(args.slice(0,3));return arc.apply(this,args);};
    CanvasRenderingContext2D.prototype.fillText=function(...args){if(isRef(this))(window as any).refLabels.push(args[0]);return text.apply(this,args);};
    const v=(window as any).testVideo;v.liveClock=false;v.seekTo(6.1);v.pauseVideo();
  });
  await page.locator('#song-timing-offset').fill('100');
  await expect.poll(()=>page.evaluate(()=>{
    const arcs=(window as any).refArcs;return arcs.length>1&&Math.abs(arcs[0][1]-arcs.find((a:number[])=>a[2]===19)[1])<.01;
  })).toBe(true);
  expect(await page.evaluate(()=>(window as any).refLabels)).toContain('1');
  await page.locator('#song-timing-offset').fill('150');
  await expect.poll(()=>page.evaluate(()=>{
    const arcs=(window as any).refArcs;return arcs.find((a:number[])=>a[2]===19)[1]<arcs[0][1];
  })).toBe(true);
  await page.locator('#song-timing-back').click();
  expect(await page.evaluate(()=>(window as any).testVideo.time)).toBe(0);
  await page.evaluate(()=>{const v=(window as any).testVideo;v.seekTo(18);v.setState(0);});
  await expect(page.locator('#song-timing-status')).toContainText('10回の合図が終了');
  await page.locator('#song-timing-start').click();expect(await page.evaluate(()=>(window as any).testVideo.time)).toBe(0);
});

test('opening calibration before API readiness initializes both players and closing it keeps main play usable',async({page})=>{
  await page.unroute('https://www.youtube.com/iframe_api');
  await page.route('https://www.youtube.com/iframe_api',async r=>{await new Promise(resolve=>setTimeout(resolve,250));await r.fulfill({body:api});});
  await page.goto('/game.html?timing=1');await expect(page.locator('.song-timing-preview')).toBeVisible();
  await expect(page.locator('#song-timing-start')).toBeEnabled();
  await page.locator('#song-timing-close').click();await expect(page.locator('#restart')).toBeEnabled();
});

test('reference video, note line and controls remain reachable on phone portrait and landscape',async({page})=>{
  await page.goto('/game.html?timing=1');await expect(page.locator('#song-timing-start')).toBeEnabled();
  for(const [width,height] of [[320,568],[390,844],[844,390],[1280,900]]) {
    await page.setViewportSize({width,height});
    const panel=page.locator('.song-timing-preview');
    await expect.poll(()=>panel.evaluate(d=>d.scrollWidth<=d.clientWidth+1)).toBe(true);
    const frame=await page.locator('.song-timing-media iframe').boundingBox();
    expect(frame!.width).toBeGreaterThanOrEqual(200);expect(frame!.height).toBeGreaterThanOrEqual(200);
    await page.locator('#song-timing-offset').fill('100');await page.locator('#song-timing-apply').scrollIntoViewIfNeeded();
    await expect(page.locator('#song-timing-apply')).toBeInViewport();
    if(width===844) {
      await panel.evaluate(d=>d.scrollTop=0);
      await expect(page.locator('.song-timing-media iframe')).toBeInViewport({ratio:1});
      await expect(page.locator('.song-timing-field canvas')).toBeInViewport({ratio:1});
      await expect(page.locator('#song-timing-offset')).toBeInViewport({ratio:1});
    }
  }
});
