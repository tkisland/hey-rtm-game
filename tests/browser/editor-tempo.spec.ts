import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {api} from './mock-video';

test.beforeEach(async({page})=>{
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({body:''}));
  await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({body:api}));
});
const stored = (page:Page) => page.evaluate(()=>JSON.parse(localStorage.getItem('hey-rhythm-editor-v1:biscuit-case')!));

test('new chart has the variable tempo grid; existing drafts require explicit application before quantize',async({page})=>{
  await page.goto('/editor.html?song=biscuit-case');await expect(page.locator('#record-toggle')).toBeEnabled();
  await expect(page.locator('#tempo-info')).toContainText('200 → 205 → 200 → 205 → 203 → 205 → 200');
  await page.locator('#tempo-map summary').click();await expect(page.locator('.tempo-row')).toHaveCount(6);
  await expect(page.locator('#apply-song-tempo')).toHaveText('曲のテンポを適用');
  const draft={videoId:'JUsGoi24rug',title:'saved draft',bpm:180,beatOrigin:4,startTime:24.01,notes:[
    {id:1,time:24.01,lane:0,type:'tap',sourceTime:24.01},
    {id:2,time:27.04,lane:1,type:'tap',sourceTime:27.04},
  ]};
  await page.goto('/');
  await page.evaluate(draft=>localStorage.setItem('hey-rhythm-editor-v1:biscuit-case',JSON.stringify(draft)),draft);
  await page.goto('/editor.html?song=biscuit-case');await expect(page.locator('#record-toggle')).toBeEnabled();
  await expect(page.locator('#editor-bpm')).toHaveValue('180');await expect(page.locator('.tempo-row')).toHaveCount(0);
  await page.locator('#tempo-map summary').click();await page.locator('#apply-song-tempo').click();
  await expect(page.locator('#save-status')).toContainText('保存しました');
  let data=await stored(page);expect(data.notes).toEqual(draft.notes);expect(data.tempoChanges).toHaveLength(6);
  await page.locator('#quantize').click();await expect(page.locator('#save-status')).toContainText('保存しました');
  data=await stored(page);expect(data.notes[0].time).toBeCloseTo(24.03,9);expect(data.notes[1].time).toBeCloseTo(27.044611254167,9);
  expect(data.notes.map((n:any)=>n.sourceTime)).toEqual([24.01,27.04]);
  await page.locator('#undo').click();await expect(page.locator('#save-status')).toContainText('保存しました');
  expect((await stored(page)).notes).toEqual(draft.notes);
  await page.reload();await expect(page.locator('#tempo-info')).toContainText('6箇所');
});

test('tempo rows can be refined, added and removed with undo; invalid changes preserve the draft',async({page})=>{
  await page.goto('/editor.html?song=biscuit-case');await expect(page.locator('#record-toggle')).toBeEnabled();
  await page.locator('#tempo-map summary').click();
  const seconds=page.getByRole('spinbutton',{name:'テンポ変更1の秒数',exact:true});
  await seconds.fill('25');await seconds.blur();
  await expect(page.locator('#save-status')).toContainText('保存しました');
  expect((await stored(page)).tempoChanges[0]).toEqual({time:25,bpm:205.000649169});
  await page.getByRole('spinbutton',{name:'テンポ変更1のBPM',exact:true}).fill('206');
  await page.getByRole('spinbutton',{name:'テンポ変更1のBPM',exact:true}).blur();
  await expect(page.locator('#save-status')).toContainText('保存しました');
  const before=await stored(page);
  await seconds.fill('2');await seconds.blur();await expect(page.locator('#editor-notice')).toContainText('テンポ変更');
  await expect(seconds).toHaveValue('25');expect(await stored(page)).toEqual(before);
  await page.evaluate(()=>{const video=(window as any).testVideo;video.liveClock=false;video.seekTo(50);video.pauseVideo();});
  await page.locator('#add-tempo-change').click();await expect(page.locator('.tempo-row')).toHaveCount(7);
  await expect(page.getByRole('spinbutton',{name:'テンポ変更2の秒数',exact:true})).toHaveValue('50');
  await page.getByRole('button',{name:'テンポ変更2を削除',exact:true}).click();await expect(page.locator('.tempo-row')).toHaveCount(6);
  await page.locator('#undo').click();await expect(page.locator('.tempo-row')).toHaveCount(7);
  await expect(page.locator('#save-status')).toContainText('保存しました');
  await page.reload();await page.locator('#tempo-map summary').click();
  await expect(page.getByRole('spinbutton',{name:'テンポ変更1のBPM',exact:true})).toHaveValue('206');
  await expect(page.locator('.tempo-row')).toHaveCount(7);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
