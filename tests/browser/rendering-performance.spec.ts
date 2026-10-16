import {test,expect} from '@playwright/test';
import {api} from './mock-video';

test.beforeEach(async({page})=>{
  await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
  await page.goto('/game.html?chart=test');
  await expect(page.locator('#restart')).toBeEnabled();
});

test('high-density rendering caps pixels, reuses the fixed floor and refreshes it after resize',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {Renderer}=await import('/src/renderer.ts');
    const canvas=document.createElement('canvas');
    canvas.style.cssText='position:fixed;width:370px;height:480px;opacity:0;pointer-events:none';
    document.body.append(canvas);
    const density=Object.getOwnPropertyDescriptor(window,'devicePixelRatio');
    Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:3});
    const width=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,'width')!;
    let resizes=0;
    Object.defineProperty(canvas,'width',{configurable:true,get(){return width.get!.call(this);},set(value){resizes++;width.set!.call(this,value);}});
    const proto=CanvasRenderingContext2D.prototype,gradient=proto.createLinearGradient;
    let gradients=0;
    proto.createLinearGradient=function(...args){gradients++;return gradient.apply(this,args);};
    const renderer=new Renderer(canvas),notes:[]=[];
    const draw=()=>{gradients=0;renderer.draw(notes,10,2.5,0);return gradients;};
    try {
      const initialResizes=resizes,cold=draw(),warm=draw(),second=draw();
      const original={width:canvas.width,height:canvas.height,scale:canvas.getContext('2d')!.getTransform().a,resizes:resizes-initialResizes};
      canvas.style.width='400px';
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      const resizedCold=draw(),resizedWarm=draw();
      return{original,cold,warm,second,resizedCold,resizedWarm,width:canvas.width,scale:canvas.getContext('2d')!.getTransform().a};
    } finally {
      proto.createLinearGradient=gradient;
      renderer.destroy();canvas.remove();
      if(density)Object.defineProperty(window,'devicePixelRatio',density);else delete (window as any).devicePixelRatio;
    }
  });
  expect(result.original).toEqual({width:740,height:960,scale:2,resizes:0});
  expect(result.cold).toBeGreaterThan(result.warm+5);
  expect(result.warm).toBeLessThanOrEqual(2);expect(result.second).toBe(result.warm);
  expect(result.width).toBe(800);expect(result.scale).toBe(2);
  expect(result.resizedCold).toBeGreaterThan(result.resizedWarm+5);
  expect(result.resizedWarm).toBe(result.warm);
});

test('unchanged paused and playing hints do not rewrite text or attributes each frame',async({page})=>{
  for(const playing of [false,true]) {
    await page.evaluate(playing=>{
      const video=(window as any).testVideo;video.seekTo(10);video.setState(playing?1:2);
    },playing);
    const mutations=await page.evaluate(async()=>{
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      let changes=0;
      const observer=new MutationObserver(records=>changes+=records.length);
      observer.observe(document.querySelector('#stage-hint')!,{subtree:true,attributes:true,childList:true,characterData:true});
      for(const node of document.querySelectorAll('.lane-judgement'))observer.observe(node,{attributes:true});
      for(let i=0;i<5;i++)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      observer.disconnect();return changes;
    });
    expect(mutations).toBe(0);
  }
});
