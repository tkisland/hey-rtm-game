import { expect, it } from 'vitest';
import { GameEngine } from '../src/engine';
import type { ChartNote } from '../src/chart';
import { emptyChart } from '../src/chart-data';

const tap = (lane: number, time = 10): ChartNote => ({id:lane + 1,type:'tap',lane,time});
const hold = (lane: number, endTime = 11): ChartNote => ({...tap(lane),type:'hold',endTime});
const game = (notes: ChartNote[]) => new GameEngine({...emptyChart(),notes});

it.each([2,3,6])('awards no partial points and sums all %s successful chord notes exactly once', count => {
  const engine = game(Array.from({length:count},(_,lane) => tap(lane)));
  for (let lane=0;lane<count;lane++) {
    engine.input(lane,10);
    expect(engine.score).toBe(lane === count-1 ? count*1000 : 0);
  }
  engine.advance(12); engine.input(0,10); expect(engine.score).toBe(count*1000);
});
it('gives zero points for the whole chord if one note is untouched, in either input order', () => {
  for (const lane of [0,1]) {
    const engine=game([tap(0),tap(1)]); engine.input(lane,10);
    expect(engine.score).toBe(0); engine.advance(10.161);
    expect(engine.score).toBe(0); expect(engine.counts.MISS).toBe(1);
    expect(engine.counts.PERFECT).toBe(1); expect(engine.finished).toBe(true);
  }
});
it('groups the same 1ms heads as the visible connector, but leaves separate notes independent', () => {
  const engine=game([tap(0),tap(1,10.001),tap(2,10.003)]);
  engine.input(0,10); expect(engine.score).toBe(0);
  engine.input(2,10.003); expect(engine.score).toBe(1000);
  engine.advance(10.2); expect(engine.score).toBe(1000);
});
it('cancels the tap portion of a chord when its hold tail misses', () => {
  for (const release of [10.5,11.2501]) {
    const engine=game([hold(0),tap(1)]); engine.input(1,10); engine.input(0,10);
    expect(engine.score).toBe(0); engine.release(0,release);
    expect(engine.score).toBe(0); expect(engine.counts.MISS).toBe(1);
  }
});
it('waits for different hold endpoints and uses their actual tail judgement', () => {
  const engine=game([hold(0),hold(1,12)]); engine.input(0,10); engine.input(1,10);
  engine.release(0,11.08); expect(engine.score).toBe(0);
  engine.release(1,12.15); expect(engine.score).toBe(1700);
  expect(engine.counts).toEqual({PERFECT:1,GREAT:1,GOOD:0,MISS:0});
});
it('discards incomplete chord points on a seek and resets the group settlement for replay', () => {
  const engine=game([tap(0),hold(1)]); engine.input(0,10); engine.input(1,10);
  engine.seek(10.5,false); expect(engine.score).toBe(0); expect(engine.skipped).toBe(1);
  engine.seek(9,true); engine.input(0,10); engine.input(1,10); engine.release(1,11);
  expect(engine.score).toBe(2000);
  engine.reset(); engine.input(1,10); engine.input(0,10); engine.release(1,11);
  expect(engine.score).toBe(2000);
});
