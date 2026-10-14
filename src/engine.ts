import type { Chart, TapNote } from './chart';

export const WINDOWS = { PERFECT: 0.05, GREAT: 0.1, GOOD: 0.16 } as const;
export const POINTS = { PERFECT: 1000, GREAT: 700, GOOD: 300, MISS: 0 } as const;
export type Judgement = keyof typeof POINTS;
export type NoteState = 'pending' | 'hit' | 'miss' | 'skipped';
export interface PlayNote extends TapNote { state: NoteState }
export interface Hit { judgement: Judgement; lane: number; errorMs: number; noteId: number }
const EPSILON = 1e-8;

export function judge(error: number): Judgement {
  const absolute = Math.abs(error);
  if (absolute <= WINDOWS.PERFECT + EPSILON) return 'PERFECT';
  if (absolute <= WINDOWS.GREAT + EPSILON) return 'GREAT';
  if (absolute <= WINDOWS.GOOD + EPSILON) return 'GOOD';
  return 'MISS';
}

/** All methods receive video time minus the configured offset. No independent clock. */
export class GameEngine {
  notes: PlayNote[] = [];
  score = 0;
  combo = 0;
  maxCombo = 0;
  counts: Record<Judgement, number> = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
  lastHit: Hit | null = null;
  constructor(public chart: Chart) { this.reset(); }

  reset(chart: Chart = this.chart): void {
    this.chart = chart;
    this.notes = chart.notes.map(note => ({ ...note, state: 'pending' }));
    this.score = this.combo = this.maxCombo = 0;
    this.counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
    this.lastHit = null;
  }

  private record(note: PlayNote, judgement: Judgement, error: number): Hit {
    note.state = judgement === 'MISS' ? 'miss' : 'hit';
    this.score += POINTS[judgement];
    this.counts[judgement]++;
    this.combo = judgement !== 'MISS' ? this.combo + 1 : 0;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.lastHit = { judgement, lane: note.lane, errorMs: error * 1000, noteId: note.id };
    return this.lastHit;
  }

  advance(time: number): Hit[] {
    const misses: Hit[] = [];
    for (const note of this.notes) {
      if (note.state === 'pending' && time - note.time > WINDOWS.GOOD + EPSILON) {
        misses.push(this.record(note, 'MISS', time - note.time));
      }
    }
    return misses;
  }

  input(lane: number, time: number): Hit | null {
    let nearest: PlayNote | undefined;
    let distance = Infinity;
    for (const note of this.notes) {
      const delta = Math.abs(time - note.time);
      if (note.state === 'pending' && note.lane === lane && delta <= WINDOWS.GOOD + EPSILON && delta < distance) {
        nearest = note;
        distance = delta;
      }
    }
    return nearest ? this.record(nearest, judge(time - nearest.time), time - nearest.time) : null;
  }

  /** Forward seeks skip elapsed notes; backward seeks begin a new score session. */
  seek(time: number, backwards: boolean): void {
    if (backwards) this.reset();
    this.combo = 0;
    for (const note of this.notes) {
      if (note.state === 'pending' && note.time < time - WINDOWS.GOOD - EPSILON) note.state = 'skipped';
    }
  }

  get finished(): boolean { return this.notes.every(note => note.state !== 'pending'); }
  get skipped(): number { return this.notes.filter(note => note.state === 'skipped').length; }
  get accuracy(): number {
    const judged = Object.values(this.counts).reduce((sum, count) => sum + count, 0);
    return judged ? this.score / (judged * POINTS.PERFECT) * 100 : 0;
  }
}
