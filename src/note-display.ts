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
