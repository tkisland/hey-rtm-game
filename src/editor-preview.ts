import type { Chart, ChartNote } from './chart';
import type { PlayNote } from './engine';

export interface PreviewEvent { lane: number; time: number; phase: 'tap' | 'start' | 'end' }
/** Read-only playback of the edited chart, using the editor's video clock. */
export class EditorPreview {
  notes: PlayNote[] = [];
  private chart: Chart | null = null;
  private previous: number | null = null;
  sync(chart: Chart): void {
    if (chart === this.chart) return;
    this.chart = chart;
    this.notes = chart.notes.map(note => ({ ...note, state: 'pending' }));
    this.previous = null;
  }
  seek(time: number, includeExact = false): void {
    this.previous = includeExact ? time - 1e-8 : time;
  }
  get first(): number { return Math.min(...this.notes.map(note => note.time)); }
  get end(): number { return Math.max(...this.notes.map(note => note.type === 'hold' ? note.endTime : note.time)); }
  update(time: number, playing: boolean): PreviewEvent[] {
    if (!Number.isFinite(time)) return [];
    const events: PreviewEvent[] = [];
    const previous = this.previous;
    // Do not replay skipped notes after a seek, suspension, or clock recovery.
    const crossing = playing && previous !== null && time >= previous && time - previous <= 0.5;
    for (const note of this.notes) {
      note.state = time < note.time ? 'pending' : note.type === 'hold' && time < note.endTime ? 'holding' : 'hit';
      if (!crossing) continue;
      if (note.time > previous && note.time <= time) events.push({ lane: note.lane, time: note.time, phase: note.type === 'hold' ? 'start' : 'tap' });
      if (note.type === 'hold' && note.endTime > previous && note.endTime <= time) events.push({ lane: note.lane, time: note.endTime, phase: 'end' });
    }
    this.previous = time;
    // Release before a new note in the same lane at the same instant.
    return events.sort((a, b) => a.time - b.time || Number(b.phase === 'end') - Number(a.phase === 'end') || a.lane - b.lane);
  }
}
export function previewStart(note: ChartNote | undefined, first: number, travel: number): number {
  return Math.max(0, (note?.time ?? first) - travel - 0.5);
}
