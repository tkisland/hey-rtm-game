import { describe, expect, it } from 'vitest';
import { depth, fieldGeometry, project, timingBands } from '../src/field-geometry';
import { WINDOWS, GameEngine } from '../src/engine';
import { compensateInput } from '../src/timing';
import { emptyChart } from '../src/editor-model';

describe('perspective timing windows and V targets', () => {
  it.each(['PERFECT', 'GREAT', 'GOOD'] as const)('projects both %s boundaries onto the matching engine boundary', kind => {
    for (const offset of [-300, 0, 300]) for (const height of [224, 480]) for (const travel of [1, 4]) for (let lane = 0; lane < 6; lane++) {
      const field = fieldGeometry(370, height), band = timingBands(field, lane, travel).find(band => band.kind === kind)!;
      for (const sign of [-1, 1]) {
        const time = 12 + offset / 1000 + sign * WINDOWS[kind];
        const judgeTime = compensateInput(time, offset), point = project(field, lane, 1 + (judgeTime - 12) / travel);
        expect(point.x).toBeCloseTo(sign < 0 ? band.top.x : band.bottom.x, 8);
        expect(point.y).toBeCloseTo(sign < 0 ? band.top.y : band.bottom.y, 8);
        const engine = new GameEngine({ ...emptyChart(), notes: [{ id: 1, lane, type: 'tap', time: 12 }] });
        expect(engine.input(lane, judgeTime)?.judgement).toBe(kind);
      }
    }
  });
  it('keeps full timing windows and accessible targets inside all supported screen sizes', () => {
    for (const width of [298, 370, 404, 678]) for (const height of [180, 224, 310, 480, 520]) for (const travel of [1, 2, 4]) {
      const field = fieldGeometry(width, height);
      for (let lane = 0; lane < 6; lane++) {
        const target = field.targets[lane];
        expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44);
        expect(target.x - target.width / 2).toBeGreaterThanOrEqual(0);
        expect(target.x + target.width / 2).toBeLessThanOrEqual(width);
        expect(target.y + target.height / 2).toBeLessThanOrEqual(height - 12);
        for (const band of timingBands(field, lane, travel)) {
          expect(band.top.y).toBeGreaterThan(field.origin);
          expect(band.bottom.y).toBeLessThanOrEqual(height - 8 + 1e-8);
          for (const point of [band.top, band.bottom]) {
            expect(point.x - point.width / 2).toBeGreaterThanOrEqual(0);
            expect(point.x + point.width / 2).toBeLessThanOrEqual(width);
          }
        }
      }
    }
  });
  it('uses mirrored V-shaped targets, fixed independently of speed and input correction', () => {
    const field = fieldGeometry(370, 480);
    for (let lane = 0; lane < 3; lane++) {
      const left = field.targets[lane], right = field.targets[5 - lane];
      expect(left.y).toBe(right.y); expect(left.x + right.x).toBeCloseTo(field.width);
      if (lane < 2) expect(left.y).toBeLessThan(field.targets[lane + 1].y);
    }
    for (const offset of [-300, 0, 300]) for (const travel of [1, 2, 4]) for (let lane = 0; lane < 6; lane++) {
      const point = project(field, lane, 1 + (compensateInput(12 + offset / 1000, offset) - 12) / travel);
      expect(point.x).toBeCloseTo(field.targets[lane].x); expect(point.y).toBeCloseTo(field.targets[lane].y);
    }
  });
  it('widens distant notes while keeping the approach smooth and monotonic', () => {
    const field = fieldGeometry(370, 480), far = project(field, 0, 0), near = project(field, 0, 1);
    expect(far.width).toBeLessThan(near.width); expect(far.x).toBeGreaterThan(near.x);
    let previous = far;
    for (let p = 0.01; p <= 1.16; p += 0.01) {
      const point = project(field, 0, p);
      expect(point.y).toBeGreaterThan(previous.y); expect(point.width).toBeGreaterThanOrEqual(previous.width);
      previous = point;
    }
    expect(depth(0)).toBe(0); expect(depth(1)).toBe(1);
    expect((depth(1) - depth(0.9)) / (depth(0.9) - depth(0.8))).toBeLessThan(1.1);
  });
  it('projects timing windows with the same perspective, rather than constant pixel heights', () => {
    const field = fieldGeometry(370, 480), fast = timingBands(field, 0, 1)[0], slow = timingBands(field, 0, 4)[0];
    expect(fast.bottom.y - fast.top.y).toBeGreaterThan(slow.bottom.y - slow.top.y);
    const target = field.targets[0];
    expect(target.y - fast.top.y).toBeLessThan(fast.bottom.y - target.y);
  });
  it('rejects just outside GOOD even though a thick note can visually overlap the band', () => {
    for (const error of [-0.1601, 0.1601]) {
      const field = fieldGeometry(370, 480), band = timingBands(field, 0, 2)[0], point = project(field, 0, 1 + error / 2);
      expect(point.y < band.top.y || point.y > band.bottom.y).toBe(true);
      const engine = new GameEngine({ ...emptyChart(), notes: [{ id: 1, lane: 0, type: 'tap', time: 12 }] });
      expect(engine.input(0, 12 + error)).toBeNull();
    }
  });
  it('retains the existing temporal judgement widths', () => {
    expect(WINDOWS).toEqual({ PERFECT: 0.05, GREAT: 0.1, GOOD: 0.16 });
  });
});
