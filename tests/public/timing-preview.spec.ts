import { test, expect } from '@playwright/test';
import { api } from '../browser/mock-video';
import type { Page } from '@playwright/test';
const savedCorrection = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-settings-v1') ?? '{}').inputOffset ?? 0);

test('public settings rehearse with sound and save only an applied input correction', async ({page}) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({body:api}));
  await page.addInitScript(() => {
    (window as any).referenceStarts = [];
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function(when) { (window as any).referenceStarts.push(when); start.call(this, when); };
  });
  await page.goto('/game.html'); await expect(page.locator('#restart')).toBeEnabled();
  await page.evaluate(() => (window as any).testVideo.playVideo());
  await page.locator('#settings-toggle').click(); await page.locator('#flow-calibrate').click();
  await expect(page.locator('.timing-preview')).toBeVisible();
  expect(await page.evaluate(() => (window as any).testVideo.state)).toBe(2);
  await page.locator('#timing-preview-start').click();
  await expect.poll(() => page.evaluate(() => (window as any).referenceStarts.length)).toBe(14);
  await expect(page.locator('.timing-pad')).toHaveCount(6);
  await page.locator('#timing-preview-offset').fill('100'); await page.locator('#timing-preview-offset').dispatchEvent('input');
  expect(await savedCorrection(page)).toBe(0);
  await page.locator('#timing-preview-apply').click(); expect(await savedCorrection(page)).toBe(100);
  await expect(page.locator('#score')).toHaveText('0');
  await page.reload(); await expect(page.locator('#restart')).toBeEnabled(); await page.locator('#settings-toggle').click();
  await page.locator('#flow-calibrate').click(); await expect(page.locator('#timing-preview-value')).toHaveText('+100 ms'); await page.locator('#timing-preview-plus').click();
  await expect(page.locator('#timing-preview-value')).toHaveText('+105 ms');
  await page.locator('#timing-preview-close').click(); expect(await savedCorrection(page)).toBe(100);
  await expect(page.locator('#chart-source')).toHaveCount(0);
});

test('public flow calibration automatically applies stable taps to notes and judgement', async ({page},info) => {
  await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({body:api}));
  await page.addInitScript(()=>{
    localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({noteOffset:0,inputOffset:200,travel:4,sound:false}));
    const Native=AudioContext; (window as any).flowTime=0;(window as any).flowStarts=[];
    window.AudioContext=class extends Native {get currentTime(){return (window as any).flowTime;}};
    const start=OscillatorNode.prototype.start;
    OscillatorNode.prototype.start=function(when){(window as any).flowStarts.push(when);start.call(this,when);};
  });
  await page.goto('/game.html'); await expect(page.locator('#restart')).toBeEnabled();
  await page.locator('#settings-toggle').click(); await expect(page.locator('#travel')).toHaveValue('4');
  await page.locator('#flow-calibrate').click(); await page.locator('#timing-preview-start').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).flowStarts.length)).toBe(14);
  const times=await page.evaluate(()=>(window as any).flowStarts as number[]);
  for(let i=0;i<10;i++) {
    const target=times[i+4]+.18;
    for(let time=await page.evaluate(()=>(window as any).flowTime as number)+.9;time<target;time+=.9)
      await page.evaluate(async time=>{(window as any).flowTime=time;await new Promise(requestAnimationFrame);},time);
    await page.evaluate(async time=>{(window as any).flowTime=time;await new Promise(requestAnimationFrame);},target);
    const lane=[2,3,1,4,0,5][i%6];
    if(info.project.name==='mobile-touch') await page.locator('.timing-pad').nth(lane).tap();
    else await page.keyboard.press(['s','d','f','j','k','l'][lane]);
  }
  await expect(page.locator('#timing-preview-value')).toHaveText('+180 ms');
  await expect(page.locator('#timing-preview-auto')).toContainText('自動反映');
  await expect(page.locator('#timing-preview-feedback')).toHaveText('PERFECT · ずれ 0 ms');
  expect(await savedCorrection(page)).toBe(200);
  await page.evaluate(async time=>{(window as any).flowTime=time;await new Promise(requestAnimationFrame);},times.at(-1)!+.81);
  await expect(page.locator('#timing-preview-auto')).toContainText('自動算出：+180 ms · 有効10 / 10回');
  await expect(page.locator('#timing-preview-progress')).toHaveJSProperty('value',10);
  await expect(page.locator('#timing-preview-start')).toHaveText('補正してもう一度');
  await page.locator('#timing-preview-start').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).flowStarts.length)).toBe(28);
  await expect(page.locator('#timing-preview-value')).toHaveText('+180 ms');
  await expect(page.locator('#timing-preview-apply')).toBeDisabled();
  const replay=await page.evaluate(()=>(window as any).flowStarts.slice(-14) as number[]);
  // A retry with no taps must keep the previous candidate without saving it.
  const end=replay.at(-1)!+.81;
  for(let time=await page.evaluate(()=>(window as any).flowTime as number)+.9;time<end;time+=.9)
    await page.evaluate(async time=>{(window as any).flowTime=time;await new Promise(requestAnimationFrame);},time);
  await page.evaluate(async time=>{(window as any).flowTime=time;await new Promise(requestAnimationFrame);},end);
  await expect(page.locator('#timing-preview-auto')).toContainText('有効なタップが足りません');
  await expect(page.locator('#timing-preview-value')).toHaveText('+180 ms');
  await expect(page.locator('#timing-preview-apply')).toBeDisabled();
  expect(await savedCorrection(page)).toBe(200);
  // Explicit manual confirmation remains available after an unsuccessful retry.
  await page.locator('#timing-preview-offset').dispatchEvent('input');
  await page.locator('#timing-preview-apply').click(); expect(await savedCorrection(page)).toBe(180);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!).travel)).toBe(4);
  await expect(page.locator('#score')).toHaveText('0');
});
