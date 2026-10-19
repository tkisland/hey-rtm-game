import { expect, it } from 'vitest';
import { SyncTrace, SYNC_TRACE_LIMIT } from '../src/sync-trace';
import type { SyncObservation } from '../src/sync-trace';

const sample = (value: Partial<SyncObservation> = {}): SyncObservation => ({
  atMs:0,apiTime:12,clockTime:12,judgementTime:12,playerState:1,reportedRate:1,predictionRate:1,playing:true,
  stale:false,seek:false,inputOffsetMs:0,chartOffsetMs:0,inputErrorMs:null,frameGapMs:16,fps:60,
  longTaskCount:0,longestTaskMs:0,visibility:'visible',...value,
});
it('distinguishes interpolation lead, input correction and observed API progression', () => {
  const trace=new SyncTrace();
  const first=trace.record(sample({clockTime:12.05,judgementTime:12.15,inputOffsetMs:-100}))!;
  expect(first.clockLeadMs).toBeCloseTo(50);expect(first.noteLeadMs).toBeCloseTo(150);expect(first.observedRate).toBeNull();
  trace.record(sample({atMs:1000,apiTime:12.5}));
  const slow=trace.record(sample({atMs:2000,apiTime:13,clockTime:13.05,judgementTime:13.15}))!;
  expect(slow.observedRate).toBe(.5);expect(slow.reportedRate).toBe(1);
  expect(slow.apiUpdateAgeMs).toBe(0);
});
it('tracks gaps between API updates and retains a long frame between stored rows', () => {
  const trace=new SyncTrace();trace.record(sample());
  expect(trace.record(sample({atMs:120,frameGapMs:120}))).toBeNull();
  const row=trace.record(sample({atMs:256}))!;
  expect(row.maxFrameGapMs).toBe(120);expect(row.apiUpdateAgeMs).toBe(256);
  expect(trace.record(sample({atMs:512,apiTime:12.5}))!.apiUpdateAgeMs).toBe(0);
});
it('records state/seek transitions immediately and resets rate measurement after interruptions', () => {
  const trace=new SyncTrace();trace.record(sample());
  expect(trace.record(sample({atMs:16,playerState:3,playing:false}))!.observedRate).toBeNull();
  expect(trace.record(sample({atMs:32,seek:true,apiTime:50}))!.seek).toBe(true);
  const invalid=trace.record(sample({atMs:48,apiTime:NaN,stale:true,playing:false}))!;
  expect(invalid.observedRate).toBeNull();expect(JSON.parse(JSON.stringify(invalid)).apiTime).toBeNull();
  expect(trace.record(sample({atMs:64,apiTime:50}))!.observedRate).toBeNull();
});
it('bounds retained history and exports copies without modifying live samples', () => {
  const trace=new SyncTrace();
  for(let i=0;i<600;i++)trace.record(sample({atMs:i*250,apiTime:12+i*.25}));
  const rows=trace.snapshot();expect(rows).toHaveLength(SYNC_TRACE_LIMIT);expect(rows[0].elapsedMs).toBe(30000);
  rows[0].apiTime=999;rows.pop();expect(trace.snapshot()).toHaveLength(SYNC_TRACE_LIMIT);expect(trace.snapshot()[0].apiTime).toBe(42);
});
it('retains the first playback minute even if the user waits before playing and saves at the end',()=>{
  const trace=new SyncTrace();
  for(let i=0;i<600;i++)trace.record(sample({atMs:i*250,playerState:5,playing:false,apiTime:0}));
  for(let i=0;i<1000;i++)trace.record(sample({atMs:150000+i*250,apiTime:i*.25,videoDuration:i<60?15:220}));
  const startup=trace.startupSnapshot(),events=trace.eventSnapshot();
  expect(startup.some(row=>row.playerState===1&&row.apiTime===0)).toBe(true);
  expect(startup.some(row=>row.videoDuration===15)).toBe(true);
  expect(startup.some(row=>row.videoDuration===220)).toBe(true);
  expect(startup.at(-1)!.atMs).toBeLessThanOrEqual(210000);
  expect(startup.length).toBeLessThanOrEqual(256);
  expect(trace.snapshot()[0].atMs).toBeGreaterThan(210000);
  expect(events.some(row=>row.atMs===165000&&row.videoDuration===220)).toBe(true);
  startup[0].apiTime=999;events[0].apiTime=999;
  expect(trace.startupSnapshot()[0].apiTime).not.toBe(999);expect(trace.eventSnapshot()[0].apiTime).not.toBe(999);
});
it('stores metadata transitions and short backwards reports between normal sample intervals while bounding event history',()=>{
  const trace=new SyncTrace();trace.record(sample({videoDuration:15,reportedVideoId:'ad-video'}));
  expect(trace.record(sample({atMs:16,apiTime:0,videoDuration:220,reportedVideoId:'pJDfWpZ7CI4'}))).not.toBeNull();
  for(let i=1;i<400;i++)trace.record(sample({atMs:i*32,apiTime:i%2?12:11.9,videoDuration:220,playerState:i%2?1:2}));
  expect(trace.eventSnapshot()).toHaveLength(128);expect(trace.startupSnapshot().length).toBeLessThanOrEqual(256);
});
it('retains audio startup and failure transitions between polls without exposing stored counter objects',()=>{
  const trace=new SyncTrace(),audio={enabled:true,volume:70,state:'suspended',contextTime:0,requested:3,started:0,lateDrops:0,blocked:0,sessionType:null};
  trace.record(sample({audio}));
  trace.record(sample({atMs:16,audio:{...audio,state:'running',lateDrops:3}}));
  expect(trace.eventSnapshot().map(row=>row.audio?.state)).toEqual(['suspended','running']);
  audio.requested=99;
  for(const rows of [trace.snapshot(),trace.startupSnapshot(),trace.eventSnapshot()])rows[0].audio!.requested=88;
  expect(trace.snapshot()[0].audio?.requested).toBe(3);expect(trace.startupSnapshot()[0].audio?.requested).toBe(3);expect(trace.eventSnapshot()[0].audio?.requested).toBe(3);
});

it('keeps bounded startup input details independent across samples and exported snapshots',()=>{
  const trace=new SyncTrace();
  const input={id:1,lane:0,kind:'tap',atMs:0,state:'suspended',activated:true,result:'pending' as const,elapsedMs:0,contextTime:0};
  const audio={enabled:true,volume:70,state:'running',contextTime:0,requested:1,started:0,lateDrops:0,blocked:0,sessionType:'playback',firstInputs:[input]};
  trace.record(sample({audio}));
  expect(trace.record(sample({atMs:16,audio:{...audio,firstInputs:[{...input,result:'started',elapsedMs:16}]}}))).not.toBeNull();
  input.elapsedMs=999;
  for(const rows of [trace.snapshot(),trace.startupSnapshot(),trace.eventSnapshot()]){
    expect(rows[0].audio!.firstInputs![0].elapsedMs).toBe(0);
    rows[0].audio!.firstInputs![0].elapsedMs=888;
  }
  expect(trace.snapshot()[0].audio!.firstInputs![0].elapsedMs).toBe(0);
  expect(trace.eventSnapshot()[1].audio!.firstInputs![0].result).toBe('started');
});
