import type { ChartNote } from './chart';

/** Distinct lanes with starts within 1ms are shown as simultaneous inputs. */
export function chordGroups(notes: readonly ChartNote[]): ChartNote[][] {
  const ordered = [...notes].sort((a, b) => a.time - b.time || a.lane - b.lane);
  const groups: ChartNote[][] = [];
  let group: ChartNote[] = [];
  const finish = () => { if (new Set(group.map(note => note.lane)).size > 1) groups.push(group); };
  for (const note of ordered) {
    if (group.length && note.time - group[0].time > 0.001 + 1e-8) { finish(); group = []; }
    group.push(note);
  }
  finish(); return groups;
}
export function noteThickness(size: number, spacing: number, base: number): number {
  return Math.max(2, Math.min(base * size / 100, spacing * 0.6));
}

type Point = { x: number; y: number };

/** Interpolate actual heads, with continuous tangents and no overshoot at the V's bottom. */
export function chordCurve(points: readonly Point[]): { control1: Point; control2: Point; end: Point }[] {
  if (points.length < 2) return [];
  const widths = points.slice(1).map((point, i) => point.x - points[i].x);
  const slopes = points.slice(1).map((point, i) => (point.y - points[i].y) / widths[i]);
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === points.length - 1) return slopes[i - 1];
    const before = slopes[i - 1], after = slopes[i];
    if (before * after <= 0) return 0;
    const a = 2 * widths[i] + widths[i - 1], b = widths[i] + 2 * widths[i - 1];
    return (a + b) / (a / before + b / after);
  });
  return points.slice(1).map((end, i) => {
    const start = points[i], third = widths[i] / 3;
    return {
      control1: { x: start.x + third, y: start.y + tangents[i] * third },
      control2: { x: end.x - third, y: end.y - tangents[i + 1] * third },
      end,
    };
  });
}
