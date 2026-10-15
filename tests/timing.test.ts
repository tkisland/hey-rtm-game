import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/engine';
import { emptyChart } from '../src/editor-model';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { compensateInput } from '../src/timing';

describe('input compensation', () => {
  it('judges late input without changing the chart or expiring its note prematurely', () => {
    const engine = new GameEngine({ ...emptyChart(), notes: [{ id: 1, time: 12, lane: 0, type: 'tap' }] });
    expect(engine.advance(compensateInput(12.29, 300))).toEqual([]);
    expect(engine.input(0, compensateInput(12.3, 300))?.judgement).toBe('PERFECT');
    expect(engine.chart.notes[0].time).toBe(12); expect(engine.score).toBe(1000);
  });
  it('combines video position with input correction once and preserves the GOOD boundary', () => {
    const engine = new GameEngine({ ...emptyChart(), notes: [{ id: 1, time: 12, lane: 0, type: 'tap' }] });
    const time = compensateInput(12.66 - 0.2, 300);
    expect(engine.advance(time)).toEqual([]); expect(engine.input(0, time)?.judgement).toBe('GOOD');
    const untouched = new GameEngine(engine.chart);
    expect(untouched.advance(compensateInput(12.661 - 0.2, 300))[0].judgement).toBe('MISS');
  });
  it('can compensate an early input with negative values', () => {
    const engine = new GameEngine({ ...emptyChart(), notes: [{ id: 1, time: 12, lane: 0, type: 'tap' }] });
    expect(engine.input(0, compensateInput(11.9, -100))?.judgement).toBe('PERFECT');
  });
  it('uses the same correction at hold start, release and automatic completion', () => {
    const chart = { ...emptyChart(), notes: [{ id: 1, time: 12, endTime: 13, lane: 0, type: 'hold' as const }] };
    const engine = new GameEngine(chart);
    engine.input(0, compensateInput(12.2, 200));
    expect(engine.advance(compensateInput(13.19, 200), new Set([0]))).toEqual([]);
    expect(engine.advance(compensateInput(13.2, 200), new Set([0]))[0].judgement).toBe('PERFECT');
    const released = new GameEngine(chart); released.input(0, compensateInput(12.2, 200));
    expect(released.release(0, compensateInput(13.1, 200))[0].judgement).toBe('MISS');
  });
  it('leaves zero-compensation behavior unchanged', () => {
    expect(compensateInput(12.123, 0)).toBe(12.123);
    expect(compensateInput(0.1, 300)).toBeCloseTo(-0.2);
  });
});
it('defaults older preferences to zero and validates timing ranges and steps', () => {
  expect(normalizeSettings({ soundVolume: 50, noteSize: 80 })).toMatchObject({ inputOffset: 0, soundDelay: 0, soundVolume: 50, noteSize: 80 });
  expect(normalizeSettings({ inputOffset: 1000, soundDelay: -100 })).toMatchObject({ inputOffset: 300, soundDelay: 0 });
  expect(normalizeSettings({ inputOffset: -1000, soundDelay: 1000 })).toMatchObject({ inputOffset: -300, soundDelay: 300 });
  expect(normalizeSettings({ inputOffset: 83, soundDelay: 102 })).toMatchObject({ inputOffset: 85, soundDelay: 100 });
  expect(normalizeSettings({ inputOffset: NaN, soundDelay: Infinity })).toEqual(DEFAULT_SETTINGS);
});
it('scales real input latency into video time when recording at slower playback rates', () => {
  expect(compensateInput(12, 100, 0.5)).toBeCloseTo(11.95);
  expect(compensateInput(12, 100, 0.75)).toBeCloseTo(11.925);
  expect(compensateInput(12, -100, 0.5)).toBeCloseTo(12.05);
  expect(compensateInput(12, 100)).toBeCloseTo(11.9);
});
