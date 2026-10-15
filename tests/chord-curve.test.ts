import { expect, it } from 'vitest';
import { chordCurve } from '../src/note-display';

it('connects two actual heads with a straight line, including an asymmetric pair', () => {
  for (const end of [{ x: 300, y: 100 }, { x: 300, y: 180 }]) {
    const start = { x: 20, y: 100 }, [segment] = chordCurve([start, end]);
    for (const point of [segment.control1, segment.control2, segment.end]) {
      expect((point.y - start.y) * (end.x - start.x)).toBeCloseTo((end.y - start.y) * (point.x - start.x));
    }
    expect(segment.end).toEqual(end);
  }
});

it('passes through every head with continuous tangents and no overshoot for three- and six-note chords', () => {
  const sets = [
    [{ x: 20, y: 100 }, { x: 160, y: 160 }, { x: 300, y: 100 }],
    [{ x: 20, y: 100 }, { x: 75, y: 130 }, { x: 130, y: 160 }, { x: 185, y: 160 }, { x: 240, y: 130 }, { x: 295, y: 100 }],
    [{ x: 20, y: 100 }, { x: 75, y: 115 }, { x: 295, y: 180 }],
  ];
  for (const points of sets) {
    const segments = chordCurve(points);
    expect(segments.map(segment => segment.end)).toEqual(points.slice(1));
    segments.forEach((segment, i) => {
      const start = points[i], end = segment.end;
      if (i > 0) {
        const previous = segments[i - 1];
        expect((start.y - previous.control2.y) / (start.x - previous.control2.x))
          .toBeCloseTo((segment.control1.y - start.y) / (segment.control1.x - start.x));
      }
      for (let step = 0; step <= 100; step++) {
        const t = step / 100, u = 1 - t;
        const y = u ** 3 * start.y + 3 * u ** 2 * t * segment.control1.y + 3 * u * t ** 2 * segment.control2.y + t ** 3 * end.y;
        expect(y).toBeGreaterThanOrEqual(Math.min(start.y, end.y) - 1e-8);
        expect(y).toBeLessThanOrEqual(Math.max(start.y, end.y) + 1e-8);
      }
    });
  }
});

it('does not draw a link for fewer than two heads', () => {
  expect(chordCurve([])).toEqual([]);
  expect(chordCurve([{ x: 20, y: 100 }])).toEqual([]);
});
