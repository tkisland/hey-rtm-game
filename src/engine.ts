import type { Chart, ChartNote } from './chart';
import { copyNote } from './chart';
import { chordGroups } from './note-display';

export const WINDOWS = { PERFECT: 0.05, GREAT: 0.1, GOOD: 0.16 } as const;
export const POINTS = { PERFECT: 1000, GREAT: 700, GOOD: 300, MISS: 0 } as const;
export type Judgement = keyof typeof POINTS;
export type NoteState = 'pending' | 'holding' | 'hit' | 'miss' | 'skipped';
export type PlayNote = ChartNote & { state: NoteState; judgement?: Judgement; startJudgement?: Judgement; startError?: number; activeLane?: number; pathIndex?: number };
export interface Hit { judgement: Judgement; lane: number; errorMs: number; noteId: number; phase?: 'start' | 'move'; boxComplete?: boolean }
export const playLane = (note: PlayNote): number => note.activeLane ?? note.lane;
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
  private scoreGroups = new Map<PlayNote, PlayNote[]>();
  private awarded = new Set<PlayNote[]>();
  private previousPressed = new Set<number>();
  constructor(public chart: Chart) { this.reset(); }

  reset(chart: Chart = this.chart): void {
    this.chart = chart;
    this.notes = chart.notes.map(note => ({ ...copyNote(note), state: 'pending' }));
    this.scoreGroups.clear(); this.awarded.clear();
    this.notes.forEach(note => this.scoreGroups.set(note, [note]));
    for (const group of chordGroups(this.notes) as PlayNote[][]) for (const note of group) this.scoreGroups.set(note, group);
    this.score = this.combo = this.maxCombo = 0;
    this.counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
    this.lastHit = null;
    this.previousPressed.clear();
  }

  private record(note: PlayNote, judgement: Judgement, error: number, lane = playLane(note)): Hit {
    note.state = judgement === 'MISS' ? 'miss' : 'hit';
    note.judgement = judgement;
    const group = this.scoreGroups.get(note)!;
    if (!this.awarded.has(group) && group.every(member => member.state === 'hit')) {
      this.score += group.reduce((sum, member) => sum + POINTS[member.judgement!], 0);
      this.awarded.add(group);
    }
    this.counts[judgement]++;
    this.combo = judgement !== 'MISS' ? this.combo + 1 : 0;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const boxComplete = note.gimmick === 'box' && this.notes.filter(member => member.gimmick === 'box' && member.boxId === note.boxId).every(member => member.state === 'hit');
    this.lastHit = { judgement, lane, errorMs: error * 1000, noteId: note.id, ...(boxComplete ? {boxComplete: true} : {}) };
    return this.lastHit;
  }

  advance(time: number, pressed?: ReadonlySet<number>): Hit[] {
    const updates: Hit[] = [];
    const previousPressed = this.previousPressed;
    if (pressed) this.previousPressed = new Set(pressed);
    for (const note of this.notes) {
      if (note.state === 'pending' && time - note.time > WINDOWS.GOOD + EPSILON) {
        updates.push(this.record(note, 'MISS', time - note.time));
      }
      if (note.state === 'holding' && note.type === 'hold') {
        const point = note.path?.[note.pathIndex ?? 0];
        if (point && time - point.time > WINDOWS.GOOD + EPSILON) { updates.push(this.record(note, 'MISS', time - point.time)); continue; }
        // Transfer on either the new press, or release of the old key while the next is held.
        // Holding both before the checkpoint alone cannot score it.
        const releasedCurrent = previousPressed.has(playLane(note)) && !pressed?.has(playLane(note));
        if (point && pressed?.has(point.lane) && (!previousPressed.has(point.lane) || releasedCurrent) && Math.abs(time - point.time) <= WINDOWS.GOOD + EPSILON) {
          const error = time - point.time, judgement = judge(error);
          note.activeLane = point.lane; note.pathIndex = (note.pathIndex ?? 0) + 1;
          if (POINTS[judgement] < POINTS[note.startJudgement ?? 'MISS']) { note.startJudgement = judgement; note.startError = error; }
          updates.push({judgement, lane: point.lane, errorMs: error * 1000, noteId: note.id, phase: 'move'});
        }
        if (time - note.endTime > WINDOWS.GOOD + EPSILON || (pressed && !pressed.has(playLane(note)))) {
          const hit = this.finishHold(note, time);
          updates.push(hit);
        }
      }
    }
    return updates;
  }

  input(lane: number, time: number): Hit | null {
    // A second input source cannot score notes inside an already active hold.
    if (this.notes.some(note => playLane(note) === lane && note.state === 'holding')) return null;
    let nearest: PlayNote | undefined;
    let distance = Infinity;
    for (const note of this.notes) {
      const delta = Math.abs(time - note.time);
      if (note.state === 'pending' && (note.lane === lane || note.gimmick === 'dd') && delta <= WINDOWS.GOOD + EPSILON && (delta < distance || delta === distance && nearest?.gimmick === 'dd' && note.gimmick !== 'dd')) {
        nearest = note;
        distance = delta;
      }
    }
    if (!nearest) return null;
    const error = time - nearest.time, judgement = judge(error);
    if (nearest.type === 'hold') {
      if (time >= nearest.endTime) return this.record(nearest, 'MISS', error);
      nearest.state = 'holding'; nearest.startJudgement = judgement; nearest.startError = error; nearest.activeLane = lane; nearest.pathIndex = 0;
      return this.lastHit = { judgement, lane, errorMs: error * 1000, noteId: nearest.id, phase: 'start' };
    }
    return this.record(nearest, judgement, error, lane);
  }

  private finishHold(note: PlayNote & { type: 'hold' }, time: number): Hit {
    if ((note.pathIndex ?? 0) < (note.path?.length ?? 0)) return this.record(note, 'MISS', time - note.endTime);
    const endJudgement = judge(time - note.endTime), startJudgement = note.startJudgement ?? 'MISS';
    const endIsWorse = POINTS[endJudgement] < POINTS[startJudgement];
    return this.record(note, endIsWorse ? endJudgement : startJudgement, endIsWorse ? time - note.endTime : note.startError ?? 0);
  }
  release(lane: number, time: number): Hit[] {
    return this.notes.filter((note): note is PlayNote & { type: 'hold' } => playLane(note) === lane && note.type === 'hold' && note.state === 'holding').map(note => this.finishHold(note, time));
  }

  /** Forward seeks skip elapsed notes; backward seeks begin a new score session. */
  seek(time: number, backwards: boolean): void {
    if (backwards) this.reset();
    this.previousPressed.clear();
    this.combo = 0;
    for (const note of this.notes) {
      if (note.state === 'holding') note.state = 'skipped';
      if (note.state === 'pending' && note.time < time - WINDOWS.GOOD - EPSILON) note.state = 'skipped';
    }
  }

  get finished(): boolean { return this.notes.every(note => note.state !== 'pending' && note.state !== 'holding'); }
  get skipped(): number { return this.notes.filter(note => note.state === 'skipped').length; }
  get accuracy(): number {
    const judged = Object.values(this.counts).reduce((sum, count) => sum + count, 0);
    return judged ? this.score / (judged * POINTS.PERFECT) * 100 : 0;
  }
}
