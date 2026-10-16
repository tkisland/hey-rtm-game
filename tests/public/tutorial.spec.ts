import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function open(page: Page, sound = false) {
  await page.clock.install({time:new Date('2026-10-16T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-16T00:00:01Z'));
  await page.goto('/'); await page.locator('#open-tutorial').click();
  await page.locator('#tutorial-sound').setChecked(sound);
}
async function play(page: Page) {
  await page.locator('#tutorial-start').click();
  await expect(page.locator('#tutorial-start')).toHaveText('もう一度');
  let time = 0;
  return async (to: number) => { await page.clock.runFor(to - time); time = to; };
}

test('opens on request, preserves selection and restores focus without loading video', async ({page}) => {
  const videos: string[] = []; page.on('request', request => { if (request.url().includes('youtube.com')) videos.push(request.url()); });
  await page.goto('/'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.locator('#song-search').fill('mommy'); await page.locator('#open-tutorial').click();
  await expect(page.getByRole('heading', {name:'単推し', exact:true})).toBeVisible();
  await expect(page.locator('#tutorial-previous')).toBeDisabled();
  await page.keyboard.press('s'); await expect(page.locator('#tutorial-score')).toHaveText('0 点 · COMBO 0');
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#open-tutorial')).toBeFocused(); await expect(page.locator('#song-search')).toHaveValue('mommy');
  await expect(page.locator('.song-card')).toHaveCount(1); expect(videos).toEqual([]);
});

test('judges actual note timing and ends with a score instead of accepting arbitrary taps', async ({page}) => {
  await open(page); const advance = await play(page);
  await advance(500); await page.keyboard.press('s');
  await expect(page.locator('#tutorial-score')).toHaveText('0 点 · COMBO 0');
  await advance(2667); await page.keyboard.press('d');
  await expect(page.locator('#tutorial-score')).toHaveText('0 点 · COMBO 0');
  await page.keyboard.press('s'); await expect(page.locator('#tutorial-feedback')).toHaveText('PERFECT！');
  await advance(4667); await page.keyboard.press('f');
  await advance(6667); await page.keyboard.press('l');
  await expect(page.locator('#tutorial-score')).toHaveText('3,000 点 · COMBO 3');
  await advance(7400); await expect(page.locator('#tutorial-feedback')).toContainText('3 / 3 ノーツ成功');
  await expect(page.locator('#tutorial-status')).toHaveText('練習終了');
  await play(page); await expect(page.locator('#tutorial-score')).toHaveText('0 点 · COMBO 0');
  await page.clock.runFor(7400); await expect(page.locator('#tutorial-feedback')).toContainText('0 / 3 ノーツ成功');
});

test('applies the saved input correction without changing game preferences', async ({page}) => {
  const preferences = {sound:false,soundVolume:30,inputOffset:100,soundDelay:20};
  await page.addInitScript(preferences => localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify(preferences)),preferences);
  await open(page); await expect(page.locator('#tutorial-sound')).not.toBeChecked();
  const advance = await play(page); await advance(2767); await page.keyboard.press('s');
  await expect(page.locator('#tutorial-feedback')).toHaveText('PERFECT！');
  await expect(page.locator('#tutorial-score')).toHaveText('1,000 点 · COMBO 1');
  await page.locator('#tutorial-close').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!))).toEqual(preferences);
});

test('scores both simultaneous note heads and rejects holding a button down before its note', async ({page}) => {
  await open(page); await page.locator('#tutorial-next').click(); const advance = await play(page);
  await advance(2000); await page.keyboard.down('s');
  await advance(2667); await page.keyboard.press('l');
  await expect(page.locator('#tutorial-score')).toHaveText('0 点 · COMBO 1');
  await page.keyboard.up('s'); await advance(2900);
  await expect(page.locator('#tutorial-feedback')).toContainText('MISS');
  await advance(4667); await page.keyboard.down('d'); await page.keyboard.down('k');
  await expect(page.locator('#tutorial-score')).toHaveText('2,000 点 · COMBO 2');
  await page.keyboard.up('d'); await page.keyboard.up('k');
});

test('requires holding from the moving head to its tail and cancels an interrupted run', async ({page}) => {
  await open(page); await page.locator('#tutorial-next').click(); await page.locator('#tutorial-next').click();
  const advance = await play(page); await advance(2667); await page.keyboard.down('f');
  await expect(page.locator('.tutorial-judgement').nth(2)).toHaveText('HOLD');
  await advance(3100); await page.keyboard.up('f'); await expect(page.locator('#tutorial-feedback')).toContainText('MISS');
  await advance(6000); await page.keyboard.down('s'); await advance(7334); await page.keyboard.up('s');
  await expect(page.locator('#tutorial-score')).toHaveText('1,000 点 · COMBO 1');
  await advance(8100); await expect(page.locator('#tutorial-feedback')).toContainText('1 / 2 ノーツ成功');
  const retry = await play(page); await retry(2667); await page.keyboard.down('f');
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.keyboard.up('f');
  await page.clock.runFor(9000); await expect(page.locator('#tutorial-feedback')).toContainText('中断');
  await expect(page.locator('#tutorial-progress')).toHaveJSProperty('value',0);
  const again = await play(page); await again(2667); await page.keyboard.down('f');
  await page.locator('#tutorial-close').click(); await page.keyboard.up('f'); await page.clock.runFor(9000);
  await page.locator('#open-tutorial').click(); await expect(page.locator('#tutorial-step')).toHaveText('1 / 6');
  await expect(page.locator('#tutorial-score')).toHaveText('0 点 · COMBO 0');
});

test('uses two fingers for moving chords and treats a touch-cancelled hold as a miss', async ({page}, info) => {
  test.skip(!info.project.use.hasTouch, 'Requires a touch viewport.');
  await open(page); await page.locator('#tutorial-next').click(); const advance = await play(page);
  const touch = await page.context().newCDPSession(page);
  async function down(lanes: number[]) {
    const points = await Promise.all(lanes.map(async lane => {
      const box = (await page.locator('.tutorial-pad').nth(lane).boundingBox())!;
      return {id:lane + 1,x:box.x + box.width/2,y:box.y + box.height/2};
    }));
    await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});
  }
  await advance(2667); await down([0,5]); await expect(page.locator('#tutorial-score')).toHaveText('2,000 点 · COMBO 2');
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.locator('#tutorial-next').click(); const hold = await play(page); await hold(2667); await down([2]);
  await expect(page.locator('.tutorial-judgement').nth(2)).toHaveText('HOLD');
  await touch.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await expect(page.locator('#tutorial-feedback')).toContainText('MISS');
  await expect(page.locator('#tutorial-score')).toHaveText('0 点 · COMBO 0'); await touch.detach();
});

test('plays reference, tap and hold sounds and closes its audio resources on exit', async ({page}) => {
  await page.addInitScript(() => {
    (window as any).tutorialAudioEvents = [];
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      close() { (window as any).tutorialAudioEvents.push('close'); return super.close(); }
      createBufferSource() {
        const node = super.createBufferSource(), start = node.start.bind(node);
        node.start = (...args: Parameters<typeof start>) => { (window as any).tutorialAudioEvents.push(node.loop ? 'hold' : 'tap'); start(...args); };
        return node;
      }
    };
  });
  await open(page,true); await page.locator('#tutorial-next').click(); await page.locator('#tutorial-next').click();
  const advance = await play(page); await advance(20);
  expect(await page.evaluate(() => (window as any).tutorialAudioEvents.includes('tap'))).toBe(true);
  await advance(2667); await page.keyboard.down('f');
  expect(await page.evaluate(() => (window as any).tutorialAudioEvents.includes('hold'))).toBe(true);
  await page.locator('#tutorial-close').click(); await page.keyboard.up('f');
  expect(await page.evaluate(() => (window as any).tutorialAudioEvents.filter((event: string) => event === 'close').length)).toBe(2);
});

test('keeps practice pads and controls usable on small portrait and landscape screens', async ({page}) => {
  for (const [width,height] of [[320,480],[844,390]]) {
    await page.setViewportSize({width,height}); await page.goto('/'); await page.locator('#open-tutorial').click();
    expect(await page.locator('#tutorial').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
    await page.locator('#tutorial-sound').uncheck(); await page.locator('#tutorial-start').click();
    await expect(page.locator('#tutorial-start')).toHaveText('もう一度');
    expect(await page.evaluate(() => [...document.querySelectorAll('.tutorial-pad'),document.getElementById('tutorial-close')!].every(pad => {
      const r = pad.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2) === pad;
    }))).toBe(true);
    for (let step = 0; step < 6; step++) await page.locator('#tutorial-next').click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('plays box chains, DD on any lane and a complete keyboard slide', async ({page}) => {
  await open(page);
  for (let i=0;i<3;i++) await page.locator('#tutorial-next').click();
  await expect(page.locator('#tutorial-title')).toHaveText('箱推し');
  const box=await play(page);
  for (let lane=0;lane<6;lane++) {await box(Math.round((4 + lane)*2000/3));await page.keyboard.press('sdfjkl'[lane]);}
  await expect(page.locator('#tutorial-feedback')).toHaveText('箱推し成功！');
  await expect(page.locator('#tutorial-score')).toHaveText('6,000 点 · COMBO 6');
  await page.locator('#tutorial-next').click();await expect(page.locator('#tutorial-title')).toHaveText('DD');
  const dd=await play(page);
  for (const [time,key] of [[2667,'l'],[4667,'s'],[6667,'j']] as const) {await dd(time);await page.keyboard.press(key);}
  await expect(page.locator('#tutorial-score')).toHaveText('3,000 点 · COMBO 3');
  await page.locator('#tutorial-next').click();await expect(page.locator('#tutorial-title')).toHaveText('推し変');
  const slide=await play(page);await slide(2667);await page.keyboard.down('d');
  await slide(4000);await page.keyboard.down('f');await page.keyboard.up('d');
  await expect(page.locator('#tutorial-feedback')).toContainText('推し変成功');
  await expect(page.locator('#tutorial-score')).toHaveText('0 点 · COMBO 0');
  await slide(5333);await page.keyboard.down('j');await page.keyboard.up('f');
  await slide(6667);await page.keyboard.up('j');
  await expect(page.locator('#tutorial-score')).toHaveText('1,000 点 · COMBO 1');
  await slide(7400);await expect(page.locator('#tutorial-feedback')).toContainText('1 / 1 ノーツ成功');
});

test('slides one captured touch between buttons without releasing the gesture', async ({page}, info) => {
  test.skip(!info.project.use.hasTouch,'Requires a touch viewport.');
  await open(page);for (let i=0;i<5;i++) await page.locator('#tutorial-next').click();
  const slide=await play(page),touch=await page.context().newCDPSession(page);
  const points=await Promise.all([1,2,3].map(async lane => {const box=(await page.locator('.tutorial-pad').nth(lane).boundingBox())!;return {id:1,x:box.x + box.width/2,y:box.y + box.height/2};}));
  await slide(2667);await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[points[0]]});
  await expect(page.locator('.tutorial-judgement').nth(1)).toHaveText('HOLD');
  await slide(4000);await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[points[1]]});
  await expect(page.locator('.tutorial-pad').nth(2)).toHaveClass(/pressed/);
  await expect(page.locator('.tutorial-pad').nth(1)).not.toHaveClass(/pressed/);
  await expect(page.locator('#tutorial-feedback')).toContainText('推し変成功');
  await slide(5333);await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[points[2]]});
  await expect(page.locator('.tutorial-judgement').nth(3)).toHaveText('推し変！');
  await slide(6667);await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('#tutorial-score')).toHaveText('1,000 点 · COMBO 1');await touch.detach();
});
