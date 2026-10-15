import type { Chart } from './chart';

function segments(chart: Chart): { time: number; beat: number; bpm: number }[] {
  const result = [{ time: chart.beatOrigin ?? chart.startTime, beat: 0, bpm: chart.bpm }];
  for (const change of chart.tempoChanges ?? []) {
    const previous = result[result.length - 1];
    result.push({ ...change, beat: previous.beat + (change.time - previous.time) * previous.bpm / 60 });
  }
  return result;
}
export function bpmAt(chart: Chart, time: number): number {
  let bpm = chart.bpm;
  for (const change of chart.tempoChanges ?? []) { if (change.time > time) break; bpm = change.bpm; }
  return bpm;
}
export function timeToBeat(chart: Chart, time: number): number {
  const values = segments(chart); let segment = values[0];
  for (const next of values) { if (next.time > time) break; segment = next; }
  return segment.beat + (time - segment.time) * segment.bpm / 60;
}
export function beatToTime(chart: Chart, beat: number): number {
  const values = segments(chart); let segment = values[0];
  for (const next of values) { if (next.beat > beat) break; segment = next; }
  return segment.time + (beat - segment.beat) * 60 / segment.bpm;
}
/** Preserve beat phase even when a MIDI tempo event occurs between beats. */
export function snapTime(chart: Chart, time: number, division: number): number {
  return Math.max(0, Math.min(7200, beatToTime(chart, Math.round(timeToBeat(chart, time) * division) / division)));
}
export function tempoLabel(chart: Chart): string {
  return [chart.bpm, ...(chart.tempoChanges ?? []).map(change => change.bpm)].map(bpm => String(Math.round(bpm * 100) / 100)).join(' → ');
}
