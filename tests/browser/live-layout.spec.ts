import {test,expect} from '@playwright/test';
import {api,seekPlay} from './mock-video';

test.beforeEach(async({page})=>{
  await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
  await page.goto('/game.html');await expect(page.locator('#restart')).toBeEnabled();
});
test('compact video keeps its native controls usable while the field starts high and fills the viewport',async({page})=>{
  for(const [width,height] of [[320,480],[390,844],[640,360],[844,390],[1280,900]]) {
    await page.setViewportSize({width,height});
    await expect.poll(()=>page.evaluate(()=>{
      const field=document.getElementById('game-canvas')!.getBoundingClientRect();
      const iframe=document.querySelector('iframe')!,video=iframe.getBoundingClientRect();
      const center=document.elementFromPoint(video.x+video.width/2,video.y+video.height/2);
      const separate=video.right<=field.left||field.right<=video.left||video.bottom<=field.top||field.bottom<=video.top;
      const pads=[...document.querySelectorAll('.lane-button')].every(node=>{
        const r=node.getBoundingClientRect();return r.width>=44&&r.height>=60&&r.bottom<=innerHeight-43.9;
      });
      const hud=document.querySelector('.field-hud')!.getBoundingClientRect();
      const score=document.getElementById('score')!.getBoundingClientRect();
      const panel=document.querySelector('.media-panel')!.getBoundingClientRect();
      const inMonitor=hud.top>=panel.top&&hud.bottom<=panel.bottom&&score.left>=panel.left&&score.right<=panel.right;
      return video.width>=200&&video.height>=200&&center===iframe&&separate&&pads&&
        inMonitor&&field.top<=(video.bottom<=field.top?video.bottom+4.5:64)&&field.bottom<=innerHeight+.5&&document.documentElement.scrollWidth<=innerWidth;
    })).toBe(true);
    await expect(page.locator('.playback-info')).not.toBeVisible();
  }
});
test('video status, external link and settings can be opened without pushing the field down',async({page})=>{
  const before=await page.locator('#game-canvas').boundingBox();
  await page.evaluate(()=>(window as any).testVideo.setState(0));
  await expect(page.locator('.playback-info')).not.toBeVisible();
  await page.locator('.playback-details summary').click();
  await expect(page.locator('#player-status')).toHaveText('動画の再生が終了しました');
  await expect(page.locator('.playback-info a')).toBeVisible();
  expect(await page.locator('#game-canvas').boundingBox()).toEqual(before);
  await page.locator('.playback-details summary').click();
  await page.locator('#settings-toggle').click();await expect(page.locator('#flow-calibrate')).toBeVisible();
  expect(await page.locator('#game-canvas').boundingBox()).toEqual(before);
  await page.locator('#settings-close').click();
  expect(await page.locator('#game-canvas').boundingBox()).toEqual(before);
});
test('portrait runway is longer and rendered receptors use the same shallow-stage geometry as the touch pads',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.locator('#game-canvas').evaluate(async(canvas:HTMLCanvasElement)=>{
    const {canvasGeometry}=await import('/src/field-geometry.ts');
    const field=canvasGeometry(canvas),r=canvas.getBoundingClientRect();
    // The previous 390x844 layout provided about 268 CSS pixels of approach.
    return field.approach>=299&&field.origin===40&&[...document.querySelectorAll('.game .lane-receptor')].every((node,lane)=>{
      const receptor=node.getBoundingClientRect();
      return Math.abs(receptor.top+receptor.height/2-r.top-field.targets[lane].y)<.1;
    });
  })).toBe(true);
});
test('closing and reopening results preserves playback and the field position',async({page})=>{
  const before=await page.locator('#game-canvas').boundingBox();
  await seekPlay(page,219);await expect(page.locator('#result')).toBeVisible();
  await page.locator('#result-close').click();await expect(page.locator('#result')).not.toBeVisible();
  expect(await page.locator('#game-canvas').boundingBox()).toEqual(before);
  await page.locator('.playback-details summary').click();await page.locator('#show-result').click();
  await expect(page.locator('#result')).toBeVisible();
  expect(await page.evaluate(()=>(window as any).testVideo.getPlayerState())).toBe(1);
});

test('paused playback shows its status without the repeated note instructions',async({page})=>{
  await seekPlay(page,12);
  await page.evaluate(()=>(window as any).testVideo.pauseVideo());
  await expect(page.locator('#stage-hint strong')).toHaveText('一時停止中');
  await expect(page.locator('#stage-hint')).not.toContainText(/ハートのバー|終点で離す/);
});
