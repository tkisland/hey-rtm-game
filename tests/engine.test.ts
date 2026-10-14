import { describe, expect, it } from 'vitest';
import { generateChart } from '../src/chart';
import type { Chart } from '../src/chart';
import { GameEngine, judge } from '../src/engine';
import { normalizeSettings } from '../src/settings';
import { PLAYER_STATE as S, VideoClock } from '../src/sync';

function chart(times: [number, number][]): Chart {
  return { videoId: 'test', title: 'test', bpm: 140, startTime: 12, notes: times.map(([time, lane], i) => ({ id: i + 1, time, lane, type: 'tap' })) };
}
describe('judgement and score', () => {
  it.each([[0.05, 'PERFECT'], [-0.05, 'PERFECT'], [0.0501, 'GREAT'], [-0.1, 'GREAT'], [0.1001, 'GOOD'], [0.16, 'GOOD'], [0.1601, 'MISS']])('judges boundary %s as %s', (delta, expected) => {
    expect(judge(delta as number)).toBe(expected);
  });
  it('selects the nearest note, consumes it once, and rejects out-of-window inputs', () => {
    const game = new GameEngine(chart([[12, 0], [12.2, 0]]));
    expect(game.input(0, 12.19)?.noteId).toBe(2);
    expect(game.input(0, 12.19)).toBeNull();
    expect(game.score).toBe(1000);
    expect(game.input(1, 12)).toBeNull();
  });
  it('judges simultaneous notes independently and continues combo for every non-MISS judgement', () => {
    const game = new GameEngine(chart([[12, 0], [12, 3], [13, 1], [14, 2]]));
    game.input(0, 12); game.input(3, 12.08);
    expect(game.combo).toBe(2);
    game.input(1, 13.15);
    expect(game.combo).toBe(3);
    expect(game.maxCombo).toBe(3);
    expect(game.score).toBe(2000);
    game.advance(14.161);
    expect(game.combo).toBe(0);
    expect(game.maxCombo).toBe(3);
    expect(game.counts).toEqual({ PERFECT: 1, GREAT: 1, GOOD: 1, MISS: 1 });
    expect(game.finished).toBe(true);
    expect(game.accuracy).toBe(50);
    expect(game.advance(15)).toEqual([]);
  });
  it('does not expire a note at exactly 160ms', () => {
    const game = new GameEngine(chart([[12, 0]]));
    expect(game.advance(12.16)).toEqual([]);
    expect(game.input(0, 12.16)?.judgement).toBe('GOOD');
  });
  it('positive offset delays the judgement and note arrival against video time', () => {
    const game = new GameEngine(chart([[12, 0]]));
    expect(game.input(0, 12 - 0.2)).toBeNull();
    expect(game.input(0, 12.2 - 0.2)?.judgement).toBe('PERFECT');
  });
  it('skips forward-seek notes without mass MISS; resets a backward score session', () => {
    const game = new GameEngine(chart([[12, 0], [13, 1], [14, 2]]));
    game.input(0, 12);
    game.seek(14, false);
    expect(game.skipped).toBe(1);
    expect(game.score).toBe(1000);
    expect(game.combo).toBe(0);
    expect(game.advance(14)).toEqual([]);
    game.input(2, 14);
    game.seek(12, true);
    expect(game.score).toBe(0);
    expect(game.input(0, 12)?.judgement).toBe('PERFECT');
    expect(game.score).toBe(1000);
  });
  it('reset regenerates chart without retaining judged notes', () => {
    const game = new GameEngine(chart([[12, 0]]));
    game.input(0, 12);
    game.reset(generateChart(100, 8));
    expect(game.chart.bpm).toBe(100);
    expect(game.notes[0].time).toBe(8);
    expect(game.score).toBe(0);
    expect(game.notes.every(note => note.state === 'pending')).toBe(true);
  });
});
describe('practice chart', () => {
  it.each([80, 140, 200])('is deterministic, bounded and supports every lane at BPM %s', bpm => {
    const generated = generateChart(bpm, 12);
    expect(generated).toEqual(generateChart(bpm, 12));
    expect(new Set(generated.notes.map(note => note.lane)).size).toBe(6);
    expect(generated.notes.every(note => note.time >= 12 && note.time < 42)).toBe(true);
    expect(new Set(generated.notes.map(note => note.id)).size).toBe(generated.notes.length);
    expect(generated.notes.some((note, i) => generated.notes[i + 1]?.time === note.time)).toBe(true);
    expect(generated.notes.some(note => note.type === 'hold')).toBe(true);
    expect(generated.notes.every(note => note.type !== 'hold' || note.endTime < 42)).toBe(true);
    for (let lane = 0; lane < 6; lane++) {
      const notes = generated.notes.filter(note => note.lane === lane);
      for (let i = 1; i < notes.length; i++) {
        expect(notes[i].time - notes[i - 1].time).toBeGreaterThan(0.29);
        const previous = notes[i - 1];
        if (previous.type === 'hold') expect(notes[i].time - previous.endTime).toBeGreaterThan(0.29);
      }
    }
  });
});
describe('video-only clock', () => {
  it('tracks video time without accumulating wall time and pauses/buffers', () => {
    const clock = new VideoClock();
    expect(clock.sample(12, S.PLAYING, 1000)).toMatchObject({ time: 12, playing: true, seek: false });
    expect(clock.sample(12.016, S.PAUSED, 1016).seek).toBe(false);
    expect(clock.sample(12.016, S.PAUSED, 20000)).toMatchObject({ time: 12.016, playing: false, seek: false });
    expect(clock.sample(12.016, S.BUFFERING, 21000).playing).toBe(false);
    expect(clock.sample(12.016, S.PLAYING, 22000).seek).toBe(false);
    expect(clock.sample(12.032, S.PLAYING, 22016).seek).toBe(false);
  });
  it('detects forward/backward seeks, including seeks while paused', () => {
    const clock = new VideoClock();
    clock.sample(12, S.PLAYING, 0);
    expect(clock.sample(20, S.PLAYING, 16)).toMatchObject({ seek: true, backwards: false });
    expect(clock.sample(10, S.PAUSED, 32)).toMatchObject({ seek: true, backwards: true });
    expect(clock.sample(11, S.PAUSED, 48).seek).toBe(true);
  });
  it('skips elapsed notes after a suspended tab resumes', () => {
    const clock = new VideoClock();
    clock.sample(12, S.PLAYING, 0);
    expect(clock.sample(30, S.PLAYING, 18000).seek).toBe(true);
  });
});
it('validates corrupt settings, limits values and preserves step sizes', () => {
  expect(normalizeSettings({ travel: 0, offset: 500, bpm: NaN, startTime: -1 })).toEqual({ travel: 1, offset: 300, bpm: 140, startTime: 0, debug: false, sound: true, soundVolume: 70, noteSize: 100, inputOffset: 0, soundDelay: 0 });
  expect(normalizeSettings({ travel: 2.13, offset: -24, bpm: 139.7, startTime: 12.16, debug: true })).toEqual({ travel: 2.25, offset: -20, bpm: 140, startTime: 12.2, debug: true, sound: true, soundVolume: 70, noteSize: 100, inputOffset: 0, soundDelay: 0 });
});
