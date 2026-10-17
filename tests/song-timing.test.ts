import { expect, it } from 'vitest';
import { SongSoundTimeline } from '../src/song-timing';
import { generateChart } from '../src/chart';
import { normalizePlayerSettings } from '../src/settings';

const chart=generateChart();chart.notes=[{id:1,time:10,lane:0,type:'tap'},{id:2,time:10,lane:1,type:'tap'},{id:3,time:11,lane:2,type:'hold',endTime:12}];
it('plays simultaneous heads and hold endpoints once on the judgement clock',()=>{
  const timeline=new SongSoundTimeline(chart);
  timeline.advance(9.9,true);expect(timeline.advance(10.01,true)).toEqual([0,1]);
  expect(timeline.advance(10.02,true)).toEqual([]);
  for(let time=10.1;time<11;time+=.1)timeline.advance(time,true);
  expect(timeline.advance(11.01,true)).toEqual([2]);
  for(let time=11.1;time<12;time+=.1)timeline.advance(time,true);
  expect(timeline.advance(12.01,true)).toEqual([2]);
});
it('never replays skipped sounds after pause, seeks, slow frames or a correction change',()=>{
  const timeline=new SongSoundTimeline(chart);timeline.advance(9.9,true);
  expect(timeline.advance(11.1,true,true)).toEqual([]);
  expect(timeline.advance(11.2,false)).toEqual([]);expect(timeline.advance(12.1,true)).toEqual([]);
  expect(timeline.advance(9.9,true)).toEqual([]);expect(timeline.advance(10.2,true)).toEqual([]);
  timeline.reset();expect(timeline.advance(10.3,true)).toEqual([]);
});
it('migrates the old combined correction exactly once and keeps the two new values independent', () => {
  const migrated = normalizePlayerSettings({inputOffset:100});
  expect(migrated).toMatchObject({noteOffset:100,inputOffset:0});
  expect(normalizePlayerSettings(migrated)).toEqual(migrated);
  expect(normalizePlayerSettings({...migrated,inputOffset:-80})).toMatchObject({noteOffset:100,inputOffset:-80});
  expect(normalizePlayerSettings({noteOffset:123,inputOffset:83,soundDelay:100})).toMatchObject({noteOffset:125,inputOffset:85,soundDelay:0});
  expect(normalizePlayerSettings({noteOffset:-999,inputOffset:999})).toMatchObject({noteOffset:-300,inputOffset:300});
});
