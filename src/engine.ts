import type { Chart, ChartNote } from './chart';
import { copyNote } from './chart';
import { timeToBeat } from './tempo';
import { playableNotes, chordGroups } from './note-display';

/** Bump with scoring/judgement rule changes; rankings must not mix rule sets. */
export const SCORE_RULES_VERSION = 3;
export const WINDOWS = { PERFECT: 0.05, GREAT: 0.1, GOOD: 0.16 } as const;
/** More forgiving releases and slide checkpoints; starts still use WINDOWS. */
export const HOLD_WINDOWS = { PERFECT: 0.1, GREAT: 0.18, GOOD: 0.25 } as const;
export const POINTS = { PERFECT: 1000, GREAT: 700, GOOD: 300, MISS: 0 } as const;
export const BOX_WINDOWS = { PERFECT:.15, GREAT:.25, GOOD:.35 } as const;
export const BOX_SWEEP_SECONDS = .35;
export const BOX_JOIN_SECONDS = .15;
interface BoxHand { id: string; progress: number; active: boolean }
export interface InputGesture { id: string; sweepOnly?: boolean }
export type Judgement = keyof typeof POINTS;
export type NoteState = 'pending' | 'holding' | 'hit' | 'miss' | 'skipped';
export type PlayNote = ChartNote & { state: NoteState; judgement?: Judgement; startJudgement?: Judgement; startError?: number; activeLane?: number; pathIndex?: number; boxProgress?: number; boxHands?: { left?: BoxHand; right?: BoxHand }; boxStarted?: number };
export interface Hit { judgement: Judgement; lane: number; errorMs: number; noteId: number; phase?: 'start' | 'move' | 'sweep'; boxComplete?: boolean; boxStep?: number; boxId?: number }
export const playLane = (note: PlayNote): number => note.activeLane ?? note.lane;
const EPSILON = 1e-8;

export function judge(error: number, windows: Readonly<Record<'PERFECT' | 'GREAT' | 'GOOD', number>> = WINDOWS): Judgement {
  const absolute = Math.abs(error);
  if (absolute <= windows.PERFECT + EPSILON) return 'PERFECT';
  if (absolute <= windows.GREAT + EPSILON) return 'GREAT';
  if (absolute <= windows.GOOD + EPSILON) return 'GOOD';
  return 'MISS';
}

/** All methods receive video time minus the configured offset. No independent clock. */
export class GameEngine {
  notes: PlayNote[] = [];
  baseScore = 0;
  comboBonus = 0;
  specialBonus = 0;
  private basePoints = 0;
  private comboPoints = 0;
  private comboSteps = new Map<PlayNote, number>();
  private specialPoints = new Map<PlayNote, number>();
  get score(): number { return this.baseScore + this.comboBonus + this.specialBonus; }
  combo = 0;
  maxCombo = 0;
  counts: Record<Judgement, number> = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
  lastHit: Hit | null = null;
  private scoreGroups = new Map<PlayNote, PlayNote[]>();
  private awarded = new Set<PlayNote[]>();
  private previousPressed = new Set<number>();
  private judgementOrder: number[] = [];
  constructor(public chart: Chart) { this.reset(); }

  nextSlideLane(lane: number): number | undefined {
    const note = this.notes.find(note => note.state === 'holding' && note.gimmick === 'slide' && playLane(note) === lane);
    return note?.path?.[note.pathIndex ?? 0]?.lane;
  }

  reset(chart: Chart = this.chart): void {
    this.chart = chart;
    this.notes = playableNotes(chart.notes).map(note => ({ ...copyNote(note), state: 'pending' }));
    this.scoreGroups.clear(); this.awarded.clear();
    this.notes.forEach(note => this.scoreGroups.set(note, [note]));
    for (const group of chordGroups(this.notes) as PlayNote[][]) for (const note of group) this.scoreGroups.set(note, group);
    this.baseScore = this.comboBonus = this.specialBonus = this.basePoints = this.comboPoints = 0;
    this.combo = this.maxCombo = 0;
    this.comboSteps.clear(); this.specialPoints.clear();
    // Precompute at load/reset, never integrate tempo or allocate beat grids on input.
    for (const note of this.notes) {
      const beats = note.type === 'hold' ? Math.max(0, Math.floor(timeToBeat(chart, note.endTime) - timeToBeat(chart, note.time) + EPSILON)) : 0;
      this.specialPoints.set(note, note.gimmick === 'box' ? 1500 : note.gimmick === 'dd' ? 450 :
        beats * 150 + (note.gimmick === 'slide' ? (note.path?.length ?? 0) * 450 : 0));
    }
    this.counts = { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 };
    this.lastHit = null;
    this.previousPressed.clear();
    this.judgementOrder = [];
  }

  private record(note: PlayNote, judgement: Judgement, error: number, lane = playLane(note)): Hit {
    note.state = judgement === 'MISS' ? 'miss' : 'hit';
    note.judgement = judgement;
    this.judgementOrder.push(note.id);
    this.counts[judgement]++;
    this.combo = judgement !== 'MISS' ? this.combo + 1 : 0;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.comboSteps.set(note, Math.min(10, Math.floor(this.combo / 10)));
    const group = this.scoreGroups.get(note)!;
    if (!this.awarded.has(group) && group.every(member => member.state === 'hit')) {
      for (const member of group) {
        const points = POINTS[member.judgement!];
        this.basePoints += points;
        this.comboPoints += points * this.comboSteps.get(member)!;
        this.specialBonus += Math.floor(this.specialPoints.get(member)! * points / POINTS.PERFECT);
      }
      // Round cumulative amounts once, so all PERFECT is exactly 1,000,000.
      this.baseScore = Math.floor(this.basePoints * 1000 / this.notes.length);
      this.comboBonus = Math.floor(this.comboPoints * 15 / this.notes.length);
      this.awarded.add(group);
    }
    this.lastHit = { judgement, lane, errorMs: error * 1000, noteId: note.id,
      ...(note.gimmick === 'box' ? {boxId:note.boxId, ...(judgement !== 'MISS' ? {boxStep:6, boxComplete:true} : {})} : {}) };
    return this.lastHit;
  }

  advance(time: number, pressed?: ReadonlySet<number>): Hit[] {
    const updates: Hit[] = [];
    const previousPressed = this.previousPressed;
    if (pressed) this.previousPressed = new Set(pressed);
    for (const note of this.notes) {
      if (note.gimmick === 'box') {
        if (note.state !== 'pending') continue;
        if (note.boxStarted !== undefined && time - note.boxStarted > BOX_SWEEP_SECONDS + EPSILON) this.resetBox(note);
        if (!note.boxProgress && time - note.time > BOX_WINDOWS.GOOD + EPSILON) updates.push(this.record(note, 'MISS', time - note.time));
        continue;
      }
      if (note.state === 'pending' && time - note.time > WINDOWS.GOOD + EPSILON) {
        updates.push(this.record(note, 'MISS', time - note.time));
      }
      if (note.state === 'holding' && note.type === 'hold') {
        const point = note.path?.[note.pathIndex ?? 0];
        if (point && time - point.time > HOLD_WINDOWS.GOOD + EPSILON) { updates.push(this.record(note, 'MISS', time - point.time)); continue; }
        // Transfer on either the new press, or release of the old key while the next is held.
        // Holding both before the checkpoint alone cannot score it.
        const releasedCurrent = previousPressed.has(playLane(note)) && !pressed?.has(playLane(note));
        if (point && pressed?.has(point.lane) && (!previousPressed.has(point.lane) || releasedCurrent) && Math.abs(time - point.time) <= HOLD_WINDOWS.GOOD + EPSILON) {
          const error = time - point.time, judgement = judge(error, HOLD_WINDOWS);
          note.activeLane = point.lane; note.pathIndex = (note.pathIndex ?? 0) + 1;
          if (POINTS[judgement] < POINTS[note.startJudgement ?? 'MISS']) { note.startJudgement = judgement; note.startError = error; }
          updates.push({judgement, lane: point.lane, errorMs: error * 1000, noteId: note.id, phase: 'move'});
        }
        if (time - note.endTime > HOLD_WINDOWS.GOOD + EPSILON || (pressed && !pressed.has(playLane(note)))) {
          const hit = this.finishHold(note, time);
          updates.push(hit);
        }
      }
    }
    return updates;
  }

  private resetBox(note: PlayNote): void {
    delete note.boxProgress; delete note.boxHands; delete note.boxStarted; delete note.startJudgement; delete note.startError;
  }
  cancelBoxGesture(id?: string): void {
    for (const note of this.notes) if (note.gimmick === 'box' && note.state === 'pending') {
      if (id === undefined) { this.resetBox(note); continue; }
      for (const hand of [note.boxHands?.left,note.boxHands?.right]) if (hand && (hand.id === id || id === 'keyboard' && hand.id.startsWith('keyboard:'))) {
        if (hand.progress < 3) { this.resetBox(note); break; }
        hand.active = false;
      }
    }
  }
  private sweepBox(note: PlayNote, lane: number, time: number, id: string): Hit | null {
    if (note.boxStarted !== undefined && time - note.boxStarted > BOX_SWEEP_SECONDS + EPSILON) this.resetBox(note);
    const owned = note.boxHands?.left?.id === id ? 'left' : note.boxHands?.right?.id === id ? 'right' : undefined;
    const side = owned ?? (lane === 2 ? 'left' : lane === 3 ? 'right' : undefined);
    if (!side) return null;
    const route = side === 'left' ? [2,1,0] : [3,4,5];
    let hand = note.boxHands?.[side];
    if (!hand) {
      const error = time - note.time;
      const other = note.boxHands?.[side === 'left' ? 'right' : 'left'];
      if (lane !== route[0] || Math.abs(error) > BOX_WINDOWS.GOOD + EPSILON || other && (!other.active || other.id === id || time - note.boxStarted! > BOX_JOIN_SECONDS + EPSILON)) return null;
      note.boxStarted ??= time;
      note.boxHands ??= {};
      hand = note.boxHands[side] = {id,progress:0,active:true};
      const judgement = judge(error, BOX_WINDOWS);
      if (!note.startJudgement || POINTS[judgement] < POINTS[note.startJudgement]) { note.startJudgement = judgement; note.startError = error; }
    }
    if (!hand.active || lane === route[hand.progress - 1]) return null;
    if (lane !== route[hand.progress]) { this.resetBox(note); return null; }
    hand.progress++;
    note.boxProgress = (note.boxHands?.left?.progress ?? 0) + (note.boxHands?.right?.progress ?? 0);
    if (note.boxProgress === 6) return this.record(note, note.startJudgement!, note.startError!, lane);
    return this.lastHit = {judgement:note.startJudgement!, lane, errorMs:note.startError! * 1000, noteId:note.id, phase:'sweep', boxId:note.boxId, boxStep:note.boxProgress};
  }
  input(lane: number, time: number, gesture: InputGesture = {id:'keyboard'}): Hit | null {
    const id = gesture.id === 'keyboard' ? `keyboard:${lane < 3 ? 'left' : 'right'}` : gesture.id;
    const activeBox = this.notes.find(note => note.gimmick === 'box' && note.state === 'pending' && note.boxProgress &&
      (note.boxHands?.left?.id === id || note.boxHands?.right?.id === id || lane === 2 && !note.boxHands?.left || lane === 3 && !note.boxHands?.right));
    if (activeBox) return this.sweepBox(activeBox, lane, time, id);
    // A second input source cannot score notes inside an already active hold.
    if (this.notes.some(note => playLane(note) === lane && note.state === 'holding')) return null;
    let nearest: PlayNote | undefined;
    let distance = Infinity;
    for (const note of this.notes) {
      const delta = Math.abs(time - note.time);
      const box = note.gimmick === 'box';
      const matches = box ? !note.boxProgress && !gesture.sweepOnly && (lane === 2 || lane === 3) : !gesture.sweepOnly && (note.lane === lane || note.gimmick === 'dd');
      const normalBeatsWide = delta === distance && (nearest?.gimmick === 'dd' || nearest?.gimmick === 'box') && note.gimmick !== 'dd' && !box;
      if (note.state === 'pending' && matches && delta <= (box ? BOX_WINDOWS.GOOD : WINDOWS.GOOD) + EPSILON && (delta < distance || normalBeatsWide)) {
        nearest = note;
        distance = delta;
      }
    }
    if (!nearest) return null;
    if (nearest.gimmick === 'box') return this.sweepBox(nearest, lane, time, id);
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
    const endJudgement = judge(time - note.endTime, HOLD_WINDOWS), startJudgement = note.startJudgement ?? 'MISS';
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
    this.cancelBoxGesture();
    this.combo = 0;
    for (const note of this.notes) {
      if (note.state === 'holding') note.state = 'skipped';
      if (note.state === 'pending' && note.time < time - (note.gimmick === 'box' ? BOX_WINDOWS.GOOD : WINDOWS.GOOD) - EPSILON) note.state = 'skipped';
    }
  }

  /** Materialized only after play; no per-frame serialization or result-object allocation. */
  rankingJudgements(): {id:number;judgement:Judgement}[] {
    const notes=new Map(this.notes.map(note=>[note.id,note]));
    return this.judgementOrder.map(id=>({id,judgement:notes.get(id)!.judgement!}));
  }
  get finished(): boolean { return this.notes.every(note => note.state !== 'pending' && note.state !== 'holding'); }
  get skipped(): number { return this.notes.filter(note => note.state === 'skipped').length; }
  get accuracy(): number {
    const judged = Object.values(this.counts).reduce((sum, count) => sum + count, 0);
    return judged ? this.basePoints / (judged * POINTS.PERFECT) * 100 : 0;
  }
}
