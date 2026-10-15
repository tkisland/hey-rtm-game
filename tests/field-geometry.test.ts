import { describe, expect, it } from 'vitest';
import { fieldGeometry } from '../src/field-geometry';
import { WINDOWS, GameEngine } from '../src/engine';
import { compensateInput } from '../src/timing';
import { emptyChart } from '../src/editor-model';

describe('visible timing windows', () => {
  it.each(['PERFECT', 'GREAT', 'GOOD'] as const)('places both %s boundaries at the engine boundary, including input compensation', kind => {
    for (const offset of [-300, 0, 300]) for (const height of [64, 350]) for (const travel of [1, 4]) {
      const field = fieldGeometry(height, travel, offset), band = field.bands.find(band => band.kind === kind)!;
      for (const sign of [-1, 1]) {
        const visualTime = 12 + offset / 1000 + sign * WINDOWS[kind];
        const y = field.anchor + (visualTime - 12) * field.speed;
        expect(y).toBeCloseTo(sign < 0 ? band.top : band.bottom, 8);
        const engine = new GameEngine({ ...emptyChart(), notes: [{ id: 1, lane: 0, type: 'tap', time: 12 }] });
        expect(engine.input(0, compensateInput(visualTime, offset))?.judgement).toBe(kind);
      }
    }
  });
  it('keeps all three bands fully visible throughout the supported settings and viewport sizes', () => {
    for (const height of [64, 120, 240, 350, 800]) for (const travel of [1, 2, 4]) for (const offset of [-300, 0, 300]) {
      const field = fieldGeometry(height, travel, offset);
      for (const band of field.bands) {
        expect(band.top).toBeGreaterThanOrEqual(0);
        expect(band.bottom).toBeLessThanOrEqual(height - 8 + 1e-8);
      }
    }
  });
  it('does not move notes or change their speed when changing input compensation', () => {
    const normal = fieldGeometry(350, 2), late = fieldGeometry(350, 2, 300), early = fieldGeometry(350, 2, -300);
    expect(late.anchor).toBe(normal.anchor); expect(early.anchor).toBe(normal.anchor);
    expect(late.speed).toBe(normal.speed); expect(early.speed).toBe(normal.speed);
    expect(late.center - normal.center).toBeCloseTo(0.3 * normal.speed);
    expect(normal.center - early.center).toBeCloseTo(0.3 * normal.speed);
  });
  it('scales the band with falling speed instead of a fixed pixel size', () => {
    const compact = fieldGeometry(64, 2), slow = fieldGeometry(350, 4), fast = fieldGeometry(350, 1);
    expect(compact.bands[0].bottom - compact.bands[0].top).toBeCloseTo(6.24);
    expect(fast.bands[0].bottom - fast.bands[0].top).toBeGreaterThan(slow.bands[0].bottom - slow.bands[0].top);
    expect(fast.bands[0].bottom - fast.bands[0].top).toBeCloseTo(0.32 * fast.speed);
  });
  it('rejects inputs whose centers are just outside either GOOD edge', () => {
    const field = fieldGeometry(350, 2, 300), band = field.bands[0];
    for (const error of [-0.1601, 0.1601]) {
      const visualTime = 12.3 + error, y = field.anchor + (visualTime - 12) * field.speed;
      expect(y < band.top || y > band.bottom).toBe(true);
      const engine = new GameEngine({ ...emptyChart(), notes: [{ id: 1, lane: 0, type: 'tap', time: 12 }] });
      expect(engine.input(0, compensateInput(visualTime, 300))).toBeNull();
    }
  });
  it('keeps the existing judgement widths unchanged', () => {
    expect(WINDOWS).toEqual({ PERFECT: 0.05, GREAT: 0.1, GOOD: 0.16 });
  });
});
