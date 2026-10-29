import {test,expect} from '@playwright/test';
import {api} from './mock-video';
import {readFileSync} from 'node:fs';
const smg=JSON.parse(readFileSync(new URL('../../src/charts/smg005.json',import.meta.url),'utf8'));

for(const id of [267,302])for(const [offset,grade] of [[-.15,'GREAT'],[.15,'GREAT'],[-.22,'GOOD'],[.22,'GOOD']] as const) {
  test(`SMG ${id} release ${offset}s shows ${grade} without a subsequent MISS`,async({page},info)=>{
    const slide=smg.notes.find(n=>n.id===id)!,tailLane=slide.path!.at(-1)!.lane;
    const duplicate=smg.notes.find(n=>n.type==='tap'&&!n.gimmick&&n.time===slide.endTime&&n.lane===tailLane)!;
    await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
    await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
    await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
    await page.addInitScript(chart=>{
      localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false}));
      localStorage.setItem('hey-rhythm-custom-chart-v1',JSON.stringify(chart));
    },{...smg,notes:[slide,duplicate]});
    await page.goto('/game.html?chart=custom');await page.clock.runFor(100);await expect(page.locator('#restart')).toBeEnabled();
    await expect(page.locator('#chart-info')).toContainText('1 NOTES');
    await page.evaluate(time=>{const v=(window as any).testVideo;v.seekTo(time);v.playVideo();},slide.time-.1);
    await page.clock.runFor(32);
    const to=async(time:number)=>{const current=await page.evaluate(()=>(window as any).testVideo.getCurrentTime());await page.clock.runFor(Math.max(0,Math.round((time-current)*1000)));};
    const touch=info.project.use.hasTouch?await page.context().newCDPSession(page):null;
    const pads=await page.locator('.lane-button').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{id:1,x:r.x+r.width/2,y:r.y+r.height/2};}));
    await to(slide.time);
    if(touch)await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pads[slide.lane]]});
    else await page.keyboard.down('sdfjkl'[slide.lane]);
    let lane=slide.lane;
    for(const point of slide.path!) {
      await to(point.time);
      if(touch)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[pads[point.lane]]});
      else {await page.keyboard.down('sdfjkl'[point.lane]);await page.keyboard.up('sdfjkl'[lane]);}
      lane=point.lane;await page.clock.runFor(16);await expect(page.locator('.lane-button').nth(lane)).toHaveClass(/holding/);
    }
    await to(slide.endTime!+offset);
    if(touch)await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    else await page.keyboard.up('sdfjkl'[lane]);
    const feedback=page.locator(`#judgement-${tailLane} .judgement-label`);
    await expect(feedback).toHaveText(grade);
    await to(slide.endTime!+.3);await expect(feedback).toHaveText(grade);
    await expect(page.locator('#combo')).toHaveText('1');
    await page.clock.runFor(1700);await expect(page.locator('#result')).toBeVisible();
    await expect(page.locator('#result-counts div').filter({hasText:grade}).locator('strong')).toHaveText('1');
    await expect(page.locator('#result-counts div').filter({hasText:'MISS'}).locator('strong')).toHaveText('0');
    await touch?.detach();
  });
}
