import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {api} from './mock-video';

const sample=readFileSync(new URL('../../charts/source/oshi-gimmicks.mid',import.meta.url));
const saved = (page: import('@playwright/test').Page) => page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-editor-v1')!));
test('imports special MIDI in the admin browser, preserves it on export, and undoes failed or successful imports',async ({page}) => {
  const errors:string[]=[];page.on('pageerror',error => errors.push(error.message));
  await page.route('https://www.youtube.com/iframe_api',route => route.fulfill({contentType:'application/javascript',body:api}));
  await page.goto('/editor.html');await expect(page.locator('#record-toggle')).toBeEnabled();
  await page.getByText('MIDIを読み込む・ギミックの指定方法',{exact:true}).click();
  await page.locator('#midi-offset').fill('7.65');
  await page.locator('#import-midi').setInputFiles({name:'oshi.mid',mimeType:'audio/midi',buffer:sample});
  await expect(page.locator('#editor-notice')).toContainText('MIDIを読み込みました');
  await expect(page.locator('#save-status')).toContainText('保存しました');
  const data=await saved(page);
  expect(data.notes.filter((n:any) => n.gimmick==='box')).toHaveLength(6);
  expect(data.notes.filter((n:any) => n.gimmick==='dd')).toHaveLength(2);
  expect(data.notes.find((n:any) => n.gimmick==='slide').path).toHaveLength(2);
  await page.locator('#import-midi').setInputFiles({name:'broken.mid',mimeType:'audio/midi',buffer:Buffer.from('broken')});
  await expect(page.locator('#editor-notice')).not.toContainText('MIDIを読み込みました');expect(await saved(page)).toEqual(data);
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-chart').click();
  const download=await downloadPromise,stream=await download.createReadStream(),parts:Buffer[]=[];
  for await(const part of stream!)parts.push(part);expect(JSON.parse(Buffer.concat(parts).toString())).toEqual(data);
  await page.locator('#undo').click();await expect(page.locator('#note-count')).toHaveText('0 NOTES');
  await page.locator('#redo').click();await expect(page.locator('#note-count')).toHaveText(`${data.notes.length - 5} NOTES`);
  expect(errors).toEqual([]);
});

test('edits DD and slide checkpoints through the browser and uses the real game input pipeline',async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify({sound:false})));
  await page.route('https://www.youtube.com/iframe_api',route => route.fulfill({contentType:'application/javascript',body:api}));
  await page.goto('/editor.html');await expect(page.locator('#record-toggle')).toBeEnabled();
  const chart={videoId:'pJDfWpZ7CI4',title:'推しノーツ',bpm:120,startTime:10,beatOrigin:0,notes:[{id:1,type:'tap',time:10,lane:0},{id:2,type:'tap',time:14,lane:2}]};
  await page.locator('#import-chart').setInputFiles({name:'chart.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(chart))});
  await page.getByText('表示範囲のノーツ一覧（最大100個）',{exact:true}).click();
  await page.getByRole('button',{name:'ノーツ1を選択',exact:true}).click();await page.locator('#note-type').selectOption('slide');
  await page.locator('#note-end').fill('13');await page.locator('#note-end').blur();
  await page.locator('#slide-path').fill('11:2, 12:3');await page.locator('#slide-path').blur();
  await page.locator('#view-start').fill('13');await page.locator('#view-start').blur();
  await page.getByRole('button',{name:'ノーツ2を選択',exact:true}).click();await page.locator('#note-type').selectOption('dd');
  await page.locator('#try-game').click();await expect(page.locator('#chart-source')).toHaveValue('custom');
  await expect(page.locator('#play-start')).toBeEnabled();
  // Native key dispatch must not drift out of PERFECT while other browser suites run.
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  await page.evaluate(()=>{const video=(window as any).testVideo;video.seekTo(9.75);video.playVideo();});
  await page.clock.runFor(250);await page.keyboard.down('s');
  await page.clock.runFor(1000);await page.keyboard.down('d');await page.keyboard.up('s');
  await expect(page.locator('.judgement-label').nth(1)).toHaveText(/オシ変|HOLD/);
  await page.clock.runFor(1000);await page.keyboard.down('f');await page.keyboard.up('d');
  await page.clock.runFor(1000);await page.keyboard.up('f');await expect(page.locator('#score')).toHaveText('501,800');
  await page.clock.runFor(1000);await page.keyboard.press('l');await expect(page.locator('#score')).toHaveText('1,002,250');
  await page.clock.runFor(1600);await expect(page.locator('#result-score')).toHaveText('1,002,250');
});
