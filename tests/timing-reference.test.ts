import {expect,it} from 'vitest';
import {TIMING_REFERENCE,TIMING_CUES,referenceProgress} from '../src/timing-reference';
import {normalizePlayerSettings} from '../src/settings';

it('matches the uploaded reference video and its ten exact cue onsets',()=>{
  expect(TIMING_REFERENCE.videoId).toBe('SFqCNFPPqBE');
  expect(TIMING_CUES.map(c=>[c.number,c.time])).toEqual(Array.from({length:10},(_,i)=>[i+1,i+6]));
});
it('arrives at the line with the same offset sign and selected travel time as game play',()=>{
  for(const travel of [1, 2.5, 4]) for(const cue of TIMING_CUES) for(const offset of [-300,0,100,300]) {
    const arrival=cue.time+offset/1000;
    expect(referenceProgress(arrival,cue.time,offset,travel)).toBeCloseTo(1);
    expect(referenceProgress(arrival-travel,cue.time,offset,travel)).toBeCloseTo(0);
    expect(referenceProgress(arrival-.05,cue.time,offset,travel)).toBeLessThan(1);
  }
});
it('migrates the old combined correction exactly once and keeps the two new values independent', () => {
  const migrated = normalizePlayerSettings({inputOffset:100});
  expect(migrated).toMatchObject({noteOffset:100,inputOffset:0});
  expect(normalizePlayerSettings(migrated)).toEqual(migrated);
  expect(normalizePlayerSettings({...migrated,inputOffset:-80})).toMatchObject({noteOffset:100,inputOffset:-80});
  expect(normalizePlayerSettings({noteOffset:123,inputOffset:83,soundDelay:100})).toMatchObject({noteOffset:125,inputOffset:85,soundDelay:0});
  expect(normalizePlayerSettings({noteOffset:-999,inputOffset:999})).toMatchObject({noteOffset:-300,inputOffset:300});
});
