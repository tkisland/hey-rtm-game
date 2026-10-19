import {test,expect} from '@playwright/test';
import {api} from '../browser/mock-video';

for(const entry of ['game-button','youtube-player'] as const)test(`game output requests playback before creation and sounds from the first six inputs (${entry})`,async({page},info)=>{
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
  await page.addInitScript(()=>{
    const result=(window as any).gameAudio={type:'auto',created:[] as string[],starts:0,rms:0};
    Object.defineProperty(navigator,'audioSession',{configurable:true,value:{get type(){return result.type;},set type(value){result.type=value;}}});
    const Native=window.AudioContext;
    window.AudioContext=class extends Native {
      constructor(...args:ConstructorParameters<typeof AudioContext>){super(...args);result.created.push(result.type);}
      get state():AudioContextState{return result.type==='playback'?super.state:'suspended';}
      resume(){return result.type==='playback'?super.resume():Promise.resolve();}
      createBufferSource(){const source=super.createBufferSource(),start=source.start.bind(source);source.start=(...args:Parameters<typeof start>)=>{result.starts++;start(...args);};return source;}
    };
    const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(destination:any,...args:any[]):any {
      if(destination===this.context.destination){
        const meter=this.context.createAnalyser();meter.fftSize=256;
        (connect as any).call(this,meter);(connect as any).call(meter,destination,...args);
        const data=new Float32Array(meter.fftSize);
        setInterval(()=>{meter.getFloatTimeDomainData(data);result.rms=Math.max(result.rms,Math.sqrt(data.reduce((sum,x)=>sum+x*x,0)/data.length));},5);
        return destination;
      }
      return (connect as any).call(this,destination,...args);
    };
  });
  await page.goto(entry==='game-button'?'/game.html?song=biscuit-case':'/game.html');
  await expect(page.locator('#play-start')).toBeEnabled();
  expect(await page.evaluate(()=>(window as any).gameAudio.type)).toBe('auto');
  if(entry==='game-button')await page.locator('#play-start').click();
  else {
    await page.evaluate(()=>(window as any).testVideo.playVideo());
    await expect.poll(()=>page.evaluate(()=>(window as any).testVideo.getPlayerState())).toBe(2);
    await expect(page.locator('#stage-hint')).toContainText('ゲーム側の「▶ 再生」');
    await page.locator('#play-start').click();
  }
  await expect.poll(()=>page.evaluate(()=>(window as any).testVideo.getPlayerState())).toBe(1);
  for(let lane=0;lane<6;lane++){
    await page.evaluate(()=>(window as any).gameAudio.rms=0);
    if(info.project.name==='mobile-touch')await page.locator('.lane-button').nth(lane).tap();
    else await page.keyboard.press(['s','d','f','j','k','l'][lane]);
    await expect.poll(()=>page.evaluate(()=>(window as any).gameAudio.starts)).toBe(lane+1);
    await expect.poll(()=>page.evaluate(()=>(window as any).gameAudio.rms)).toBeGreaterThan(.005);
  }
  expect(await page.evaluate(()=>(window as any).gameAudio.created)).toEqual(['playback']);
  await expect.poll(()=>page.evaluate(()=>(window as any).gameAudio.rms)).toBeGreaterThan(.005);
  const position=await page.evaluate(()=>(window as any).testVideo.getCurrentTime());
  await page.locator('#settings-toggle').click();await page.locator('#sound-volume').fill('0');
  expect(await page.evaluate(()=>(window as any).gameAudio.type)).toBe('auto');
  await page.locator('#sound-volume').fill('35');
  expect(await page.evaluate(()=>(window as any).gameAudio.type)).toBe('playback');
  expect(await page.evaluate(()=>(window as any).gameAudio.created)).toHaveLength(1);
  expect(await page.evaluate(()=>(window as any).testVideo.getCurrentTime())).toBeGreaterThanOrEqual(position);
});
