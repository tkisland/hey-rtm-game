import {expect,it} from 'vitest';
import {findDifficulty,cloudChartPath} from '../src/difficulties';
import {DEFAULT_SONG,songStorageKey,songUrl} from '../src/songs';
import {bundledChart} from '../src/bundled-charts';
import {parseCloudChart,chartJson} from '../src/cloud-schema';

it('keeps old URLs, storage and publications as normal and isolates additional levels',()=>{
  expect(findDifficulty(null)).toBe('normal');expect(findDifficulty('normal')).toBe('normal');expect(findDifficulty('unknown')).toBeUndefined();
  expect(songUrl(DEFAULT_SONG,'game')).toBe('./game.html?song=super-mommy-girls');
  expect(songUrl(DEFAULT_SONG,'game',false,'hard')).toContain('difficulty=hard');
  expect(songStorageKey('draft',DEFAULT_SONG)).toBe('draft');expect(songStorageKey('draft',DEFAULT_SONG,'easy')).toBe('draft:easy');
  expect(cloudChartPath('publishedCharts',DEFAULT_SONG.id,'normal')).toEqual(['publishedCharts',DEFAULT_SONG.id]);
  expect(cloudChartPath('publishedCharts',DEFAULT_SONG.id,'hard')).toEqual(['publishedCharts',DEFAULT_SONG.id,'difficulties','hard']);
  expect(bundledChart(DEFAULT_SONG,'normal')?.notes.length).toBeGreaterThan(0);
  expect(bundledChart(DEFAULT_SONG,'easy')!.notes.length).toBeGreaterThan(0);expect(bundledChart(DEFAULT_SONG,'hard')!.notes.length).toBeGreaterThan(0);
  expect(bundledChart({...DEFAULT_SONG,charts:undefined},'easy')).toBeNull();
});
it('does not serve another difficulty or a legacy normal chart as easy/hard',()=>{
  const chart=bundledChart(DEFAULT_SONG)!,json=chartJson(chart,DEFAULT_SONG),record={songId:DEFAULT_SONG.id,videoId:DEFAULT_SONG.videoId,revision:1,json,noteCount:chart.notes.length};
  expect(parseCloudChart({...record,schemaVersion:1},DEFAULT_SONG,true).chart.notes).toHaveLength(chart.notes.length);
  expect(parseCloudChart({...record,schemaVersion:2,difficulty:'easy'},DEFAULT_SONG,true,'easy').revision).toBe(1);
  expect(()=>parseCloudChart({...record,schemaVersion:1},DEFAULT_SONG,true,'easy')).toThrow();
  expect(()=>parseCloudChart({...record,schemaVersion:2,difficulty:'easy'},DEFAULT_SONG,true,'hard')).toThrow();
  expect(()=>parseCloudChart({...record,schemaVersion:2,difficulty:'easy'},DEFAULT_SONG,true,'normal')).toThrow();
});
