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
