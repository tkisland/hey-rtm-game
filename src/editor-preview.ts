import type { Chart, ChartNote } from './chart';
import { laneAt } from './chart';
import { boxGroups } from './note-display';
import type { PlayNote } from './engine';

export interface PreviewEvent { lane: number; time: number; phase: 'tap' | 'start' | 'end' | 'move'; boxStep?: number; boxId?: number; boxComplete?: boolean }
/** Read-only playback of the edited chart, using the editor's video clock. */
export class EditorPreview {
  notes: PlayNote[] = [];
  private chart: Chart | null = null;
  private previous: number | null = null;
  private boxes = new Map<number, number>();
  sync(chart: Chart): void {
    if (chart === this.chart) return;
    this.chart = chart;
    this.notes = chart.notes.map(note => ({ ...note, state: 'pending' }));
    this.previous = null; this.boxes.clear();
    for (const group of boxGroups(chart.notes)) group.forEach((note, i) => this.boxes.set(note.id, i + 1));
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
      note.activeLane = laneAt(note, time);
      note.pathIndex = note.path?.filter(point => point.time <= time).length;
      if (!crossing) continue;
      for (const point of note.path ?? []) if (point.time > previous && point.time <= time) events.push({lane:point.lane, time:point.time, phase:'move'});
      if (note.time > previous && note.time <= time) events.push({ lane: note.lane, time: note.time, phase: note.type === 'hold' ? 'start' : 'tap', ...(note.gimmick === 'box' ? {boxStep:this.boxes.get(note.id), boxId:note.boxId, boxComplete:this.boxes.get(note.id) === 6} : {}) });
      if (note.type === 'hold' && note.endTime > previous && note.endTime <= time) events.push({ lane: laneAt(note, note.endTime), time: note.endTime, phase: 'end' });
    }
    this.previous = time;
    // Release before a new note in the same lane at the same instant.
    return events.sort((a, b) => a.time - b.time || Number(b.phase === 'end') - Number(a.phase === 'end') || a.lane - b.lane);
  }
}
export function previewStart(note: ChartNote | undefined, first: number, travel: number): number {
  return Math.max(0, (note?.time ?? first) - travel - 0.5);
}
