import { describe, expect, it } from 'vitest';
import { CLOCK_LIMITS, PLAYER_STATE as S, VideoClock } from '../src/sync';
import { GameEngine } from '../src/engine';
import { generateChart } from '../src/chart';

describe('video-anchored interpolation', () => {
  it.each([0.7,0.5,0.1])('does not retain a large lead when reported playing time advances at %sx', actualRate => {
    const clock = new VideoClock(); let previous = 12, maximumLead = 0;
    for(let frame=0;frame<60*30;frame++) {
      const elapsed=frame/60, raw=12+elapsed*actualRate;
      const sample=clock.sample(raw,S.PLAYING,elapsed*1000,1);
      expect(sample.seek).toBe(false); expect(sample.time).toBeGreaterThanOrEqual(previous);
      maximumLead=Math.max(maximumLead,sample.time-raw); previous=sample.time;
    }
    expect(maximumLead).toBeLessThanOrEqual(.05+1e-8);
  });
  it('keeps a slow-clock note hittable instead of expiring it half a second early', () => {
    const clock=new VideoClock(), chart=generateChart();chart.notes=[{id:1,lane:0,time:14,type:'tap'}];
    const engine=new GameEngine(chart);let time=12;
    for(let frame=0;frame<=240;frame++) {
      const wall=frame/60, sample=clock.sample(12+wall*.5,S.PLAYING,wall*1000,1);
      time=sample.time;engine.advance(time);
    }
    expect(engine.counts.MISS).toBe(0);expect(engine.input(0,time)?.judgement).toBe('PERFECT');
    expect(engine.score).toBe(1000);
  });
  it.each([.1,.25,.4].flatMap(interval=>[.1,.5].map(actualRate=>[interval,actualRate])))('tracks sparse %ss updates at actual rate %sx', (interval,actualRate) => {
    const clock=new VideoClock();let previous=12;
    for(let frame=0;frame<60*30;frame++) {
      const elapsed=frame/60,actual=12+elapsed*actualRate,raw=12+Math.floor(elapsed/interval)*interval*actualRate;
      const sample=clock.sample(raw,S.PLAYING,elapsed*1000,1);
      expect(sample.seek).toBe(false);expect(sample.time).toBeGreaterThanOrEqual(previous-1e-8);
      if(elapsed>5) {expect(Math.abs(sample.time-actual)).toBeLessThan(.035);expect(sample.predictionRate).toBeCloseTo(actualRate,1);}
      previous=sample.time;
    }
  });
  it('recovers its requested prediction speed after a temporary slowdown', () => {
    const clock=new VideoClock();
    for(let frame=0;frame<60*20;frame++) {
      const elapsed=frame/60,actual=12+Math.min(elapsed,10)*.5+Math.max(0,elapsed-10);
      const sample=clock.sample(actual,S.PLAYING,elapsed*1000,1);
      expect(sample.seek).toBe(false);
      if(elapsed>15) {expect(sample.time).toBeCloseTo(actual,2);expect(sample.predictionRate).toBe(1);}
    }
  });
  it('can observe slow progression after an invalid timestamp recovers at the same cached value', () => {
    const clock=new VideoClock();clock.sample(12,S.PLAYING,0);clock.sample(NaN,S.PLAYING,16);clock.sample(12,S.PLAYING,32);
    for(let frame=1;frame<60*10;frame++) {
      const elapsed=frame/60,actual=12+elapsed*.5;
      const sample=clock.sample(actual,S.PLAYING,32+elapsed*1000,1);
      if(elapsed>5) {expect(sample.predictionRate).toBeCloseTo(.5,4);expect(sample.time).toBeCloseTo(actual,2);}
    }
  });
  it.each([0.1, 0.25, 0.4])('moves every frame with API updates every %ss without cumulative drift or false seeks', interval => {
    const clock = new VideoClock();
    let previous = 12;
    for (let frame = 0; frame < 360; frame++) {
      const time = frame / 60;
      const raw = 12 + Math.floor(time / interval) * interval;
      const sample = clock.sample(raw, S.PLAYING, time * 1000);
      expect(sample.playing).toBe(true);
      expect(sample.seek).toBe(false);
      expect(sample.rawTime).toBe(raw);
      expect(Math.abs(sample.time - (12 + time))).toBeLessThan(0.035);
      if (frame) {
        expect(sample.time - previous).toBeGreaterThanOrEqual(0.8 / 60 - 1e-8);
        expect(sample.time - previous).toBeLessThanOrEqual(1.2 / 60 + 1e-8);
      }
      previous = sample.time;
    }
  });
  it('smooths small timestamp jitter without reversing the notes', () => {
    const clock = new VideoClock();
    let raw = 12, previous = 12;
    for (let frame = 0; frame < 600; frame++) {
      const time = frame / 60;
      if (frame && frame % 6 === 0) raw = 12 + time + (frame % 12 === 0 ? -0.03 : 0.03);
      const sample = clock.sample(raw, S.PLAYING, time * 1000);
      expect(sample.seek).toBe(false);
      expect(Math.abs(sample.time - (12 + time))).toBeLessThan(0.06);
      expect(sample.time).toBeGreaterThanOrEqual(previous);
      previous = sample.time;
    }
  });
  it.each([S.PAUSED, S.BUFFERING])('freezes immediately in state %s and reanchors when playing resumes', state => {
    const clock = new VideoClock();
    clock.sample(12, S.PLAYING, 0);
    expect(clock.sample(12, S.PLAYING, 100).time).toBeCloseTo(12.1);
    const pause = clock.sample(12.08, state, 110);
    expect(pause).toMatchObject({ time: 12.08, playing: false, seek: false });
    expect(clock.sample(12.08, state, 2000).time).toBe(12.08);
    const resume = clock.sample(12.08, S.PLAYING, 2100);
    expect(resume).toMatchObject({ time: 12.08, playing: true, seek: false });
    expect(clock.sample(12.08, S.PLAYING, 2116).time).toBeCloseTo(12.096);
  });
  it('bounds prediction when timestamps stop and safely resyncs when they recover', () => {
    const clock = new VideoClock();
    clock.sample(12, S.PLAYING, 0);
    for (let wall = 16; wall <= 3000; wall += 16) {
      const sample = clock.sample(12, S.PLAYING, wall);
      expect(sample.time).toBeLessThanOrEqual(12 + CLOCK_LIMITS.prediction);
      if (wall > 500) expect(sample).toMatchObject({ playing: false, stale: true });
    }
    expect(clock.sample(15, S.PLAYING, 3016)).toMatchObject({ time: 15, seek: true, backwards: false, playing: true, stale: false });
  });
  it('detects real seeks and suspended tabs without treating sparse normal updates as seeks', () => {
    const clock = new VideoClock();
    clock.sample(12, S.PLAYING, 0);
    expect(clock.sample(12.25, S.PLAYING, 250).seek).toBe(false);
    expect(clock.sample(30, S.PLAYING, 266)).toMatchObject({ time: 30, seek: true, backwards: false });
    expect(clock.sample(10, S.PLAYING, 282)).toMatchObject({ time: 10, seek: true, backwards: true });
    expect(clock.sample(20, S.PLAYING, 10282)).toMatchObject({ time: 20, seek: true });
  });
  it('keeps the last output and disables progression on an invalid timestamp', () => {
    const clock = new VideoClock();
    clock.sample(12, S.PLAYING, 0);
    const previous = clock.sample(12, S.PLAYING, 100);
    expect(clock.sample(NaN, S.PLAYING, 116)).toMatchObject({ time: previous.time, playing: false, stale: true });
  });
  it('provides the same estimated arrival time for input judgement while the API value is unchanged', () => {
    const clock = new VideoClock();
    const chart = generateChart();
    chart.notes = [{ id: 1, time: 12.125, lane: 0, type: 'tap' }];
    const game = new GameEngine(chart);
    clock.sample(12, S.PLAYING, 0);
    const sample = clock.sample(12, S.PLAYING, 125);
    expect(sample.rawTime).toBe(12);
    expect(sample.time).toBe(12.125);
    expect(game.input(0, sample.time)?.judgement).toBe('PERFECT');
  });
});

describe('YouTube playback speed', () => {
  it.each([0.5, 2])('matches playback rate %s with sparse timestamps', rate => {
    const clock = new VideoClock();
    for (let frame = 0; frame < 300; frame++) {
      const elapsed = frame / 60;
      const sample = clock.sample(12 + Math.floor(elapsed / 0.25) * 0.25 * rate, S.PLAYING, elapsed * 1000, rate);
      expect(sample.seek).toBe(false);
      expect(Math.abs(sample.time - (12 + elapsed * rate))).toBeLessThan(0.035 * rate);
    }
  });
  it('reanchors at a playback rate change instead of accumulating a speed error', () => {
    const clock = new VideoClock();
    clock.sample(12, S.PLAYING, 0);
    clock.sample(12, S.PLAYING, 50);
    expect(clock.sample(12.1, S.PLAYING, 100, 2)).toMatchObject({ time: 12.1, seek: false });
    expect(clock.sample(12.1, S.PLAYING, 200, 2).time).toBeCloseTo(12.3);
    expect(clock.sample(12.3, S.PLAYING, 200, 1)).toMatchObject({ time: 12.3, seek: false });
    expect(clock.sample(12.3, S.PLAYING, 300, 1).time).toBeCloseTo(12.4);
  });
});
