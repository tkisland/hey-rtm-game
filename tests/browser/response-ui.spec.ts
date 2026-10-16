import {test,expect} from '@playwright/test';
import {api} from './mock-video';

test.beforeEach(async ({page}) => {
  await page.route('https://www.youtube.com/iframe_api',route => route.fulfill({body:api}));
  await page.goto('/game.html?chart=test');await expect(page.locator('#restart')).toBeEnabled();
});

test('fixed horizontal transfer arrows match checkpoint timing and do not reshape after changing lanes',async ({page}) => {
  const result=await page.locator('#game-canvas').evaluate(async (canvas:HTMLCanvasElement) => {
    const {Renderer}=await import('/src/renderer.ts'),{GameEngine}=await import('/src/engine.ts'),{fieldGeometry,project}=await import('/src/field-geometry.ts');
    const renderer=new Renderer(canvas),ctx=canvas.getContext('2d')!;
    const original={move:ctx.moveTo.bind(ctx),line:ctx.lineTo.bind(ctx),stroke:ctx.stroke.bind(ctx)};
    let path:{x:number;y:number}[]=[],arrows:{x:number;y:number}[][]=[];
    ctx.moveTo=(x,y) => {path=[{x,y}];original.move(x,y);};ctx.lineTo=(x,y) => {path.push({x,y});original.line(x,y);};
    ctx.stroke=function(...args:any[]) {if(this.lineWidth>2 && path.length===2 && Math.abs(path[0].y-path[1].y)<.001)arrows.push([...path]);return (original.stroke as any)(...args);};
    try {
      const engine=new GameEngine({videoId:'pJDfWpZ7CI4',title:'test',bpm:120,startTime:10,notes:[{id:1,type:'hold',gimmick:'slide',time:10,endTime:16,lane:1,path:[{time:12,lane:2},{time:14,lane:1}]}]});
      engine.advance(10,new Set([1]));engine.input(1,10);
      const rect=canvas.getBoundingClientRect(),field=fieldGeometry(rect.width,rect.height);
      renderer.draw(engine.notes,12.3,2.5,0,100,120,300);const before=arrows;arrows=[];
      engine.advance(12,new Set([2]));renderer.draw(engine.notes,12.3,2.5,0,100,120,300);
      return {before,after:arrows,targets:[project(field,1,1),project(field,2,1)]};
    } finally {ctx.moveTo=original.move;ctx.lineTo=original.line;ctx.stroke=original.stroke;renderer.destroy();}
  });
  expect(result.before).toHaveLength(2);expect(result.after).toEqual(result.before);
  expect(result.before[0][0].y).toBeCloseTo(result.targets[0].y,6);
  expect(result.before[0][0].x).toBeCloseTo(result.targets[0].x,6);expect(result.before[0][1].x).toBeCloseTo(result.targets[1].x,6);
  expect(result.before[1][1].x).toBeLessThan(result.before[1][0].x);
});

test('penlight decorations stay within the full thumb pads and retain keys, names and bottom clearance',async ({page}) => {
  for(const [width,height] of [[320,480],[390,844],[844,390]]) {
    await page.setViewportSize({width,height});
    await page.locator('.lane-button').first().scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.locator('.lane-button > .penlight-art')).toHaveCount(6);
    const pads=await page.locator('.lane-button').evaluateAll(nodes => nodes.map(node => {
      const pad=node.getBoundingClientRect(),art=node.querySelector('.penlight-art')!.getBoundingClientRect(),key=node.querySelector('.penlight-key')!;
      const canvas=document.getElementById('game-canvas')!.getBoundingClientRect();
      return {w:pad.width,h:pad.height,clearance:canvas.bottom-pad.bottom,inside:art.left>=pad.left&&art.right<=pad.right&&art.top>=pad.top&&art.bottom<=pad.bottom,key:key.textContent,name:node.getAttribute('aria-label'),center:document.elementFromPoint(pad.x+pad.width/2,pad.y+pad.height/2)===node};
    }));
    pads.forEach((pad,lane) => {expect(pad.w).toBeGreaterThanOrEqual(44);expect(pad.h).toBeGreaterThanOrEqual(60);expect(pad.clearance).toBeGreaterThanOrEqual(43.9);expect(pad.inside).toBe(true);expect(pad.key).toBe('SDFJKL'[lane]);expect(pad.name).toContain(`レーン${lane+1}`);expect(pad.center).toBe(true);});
  }
});

test('DD spans all six lanes throughout its flight while keeping a single note head', async ({page}) => {
  const frames = await page.locator('#game-canvas').evaluate(async (canvas: HTMLCanvasElement) => {
    const {Renderer} = await import('/src/renderer.ts'), {GameEngine} = await import('/src/engine.ts');
    const {fieldGeometry, project} = await import('/src/field-geometry.ts');
    const renderer = new Renderer(canvas), ctx = canvas.getContext('2d')!, original = ctx.roundRect.bind(ctx);
    const rect = canvas.getBoundingClientRect(), field = fieldGeometry(rect.width, rect.height);
    const engine = new GameEngine({videoId:'pJDfWpZ7CI4',title:'DD',bpm:120,startTime:10,notes:[{id:1,type:'tap',gimmick:'dd',lane:2,time:10}]});
    let heads: {left:number;right:number;y:number}[] = [];
    ctx.roundRect = function(x,y,w,h,r) {heads.push({left:x,right:x+w,y:y+h/2}); original(x,y,w,h,r);};
    try {
      return [.1,.5,1].map(p => {
        heads = []; renderer.draw(engine.notes, 10 + (p - 1) * 2.5, 2.5, 0);
        return {heads, left:project(field,-.49,p).x, right:project(field,5.49,p).x, y:project(field,2.5,p).y};
      });
    } finally {ctx.roundRect = original; renderer.destroy();}
  });
  for (const frame of frames) {
    expect(frame.heads).toHaveLength(1);
    expect(frame.heads[0].left).toBeCloseTo(frame.left,6); expect(frame.heads[0].right).toBeCloseTo(frame.right,6);
    expect(frame.heads[0].y).toBeCloseTo(frame.y,6);
  }
});
