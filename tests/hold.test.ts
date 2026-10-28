import { describe, expect, it } from 'vitest';
import type { Chart, ChartNote } from '../src/chart';
import { GameEngine } from '../src/engine';
import { EditorModel, MAX_TIME, emptyChart, parseChart } from '../src/editor-model';
import { chordGroups, noteThickness } from '../src/note-display';
import { normalizeSettings } from '../src/settings';
const hold = (lane = 0, id = 1, time = 10, endTime = 11): ChartNote => ({ id, time, lane, type: 'hold', endTime });
const game = (notes: ChartNote[] = [hold()]) => new GameEngine({ ...emptyChart(), startTime: 10, notes });
const held = (...lanes: number[]) => new Set(lanes);

describe('hold endpoint judgement and chord scoring', () => {
  it('scores only on a valid endpoint release, using the worse of head and tail', () => {
    const engine = game();
    expect(engine.input(0, 10.08)).toMatchObject({ judgement: 'GREAT', phase: 'start' });
    expect(engine.notes[0].state).toBe('holding'); expect(engine.baseScore).toBe(0); expect(engine.finished).toBe(false);
    expect(engine.advance(10.5, held(0))).toEqual([]);
    expect(engine.advance(11, held(0))).toEqual([]); expect(engine.baseScore).toBe(0);
    expect(engine.release(0, 11)).toMatchObject([{ judgement: 'GREAT', noteId: 1 }]);
    expect(engine.baseScore).toBe(Math.floor(700 * 1000 / engine.notes.length)); expect(engine.combo).toBe(1); expect(engine.finished).toBe(true);
    expect(engine.release(0, 11.1)).toEqual([]); expect(engine.advance(12, held(0))).toEqual([]);
    expect(engine.counts.GREAT).toBe(1);
  });
  it('MISSes early release once, resets combo, and cannot reacquire a failed hold', () => {
    const engine = game([{ id: 2, type: 'tap', time: 9, lane: 3 }, hold()]);
    engine.input(3, 9); engine.input(0, 10);
    expect(engine.release(0, 10.5)).toMatchObject([{ judgement: 'MISS', noteId: 1 }]);
    expect(engine.combo).toBe(0); expect(engine.maxCombo).toBe(1); expect(engine.counts.MISS).toBe(1);
    expect(engine.input(0, 10.05)).toBeNull(); expect(engine.advance(12, held())).toEqual([]);
  });
  it.each([[10.7499, 'MISS'], [10.75, 'GOOD'], [10.8199, 'GOOD'], [10.82, 'GREAT'], [10.8999, 'GREAT'], [10.9, 'PERFECT'], [11, 'PERFECT'], [11.1, 'PERFECT'], [11.1001, 'GREAT'], [11.18, 'GREAT'], [11.1801, 'GOOD'], [11.25, 'GOOD'], [11.2501, 'MISS']])('judges the actual endpoint release at %s', (time, expected) => {
    const engine = game(); engine.input(0, 10);
    expect(engine.release(0, time as number)[0].judgement).toBe(expected);
  });
  it('detects a released/focus-lost lane from actual pressed state instead of granting auto success', () => {
    const engine = game(); engine.input(0, 10);
    expect(engine.advance(10.2, held())).toMatchObject([{ judgement: 'MISS' }]);
    expect(engine.counts.MISS).toBe(1);
  });
  it('MISSes an untouched hold and disallows beginning after a short hold has ended', () => {
    const engine = game(); engine.advance(10.161, held());
    expect(engine.counts.MISS).toBe(1); expect(engine.finished).toBe(true);
    const short = game([hold(0, 1, 10, 10.03)]);
    expect(short.input(0, 10.04)?.judgement).toBe('MISS');
    expect(short.finished).toBe(true);
  });
  it('defers a hold/tap chord score until its tail succeeds and allows an endpoint tap', () => {
    const engine = game([hold(), { id: 2, time: 10, lane: 3, type: 'tap' }, { id: 3, time: 11, lane: 0, type: 'tap' }]);
    engine.input(0, 10); engine.input(3, 10.12);
    expect(engine.combo).toBe(1); expect(engine.input(0, 10)).toBeNull();
    expect(engine.baseScore).toBe(0); engine.advance(11, held(0)); engine.release(0, 11); engine.input(0, 11.05);
    expect(engine.baseScore).toBe(Math.floor(2500 * 1000 / engine.notes.length)); expect(engine.combo).toBe(3); expect(engine.finished).toBe(true);
  });
  it('keeps two holds independent when one finger releases', () => {
    const engine = game([hold(), hold(3, 2)]);
    engine.input(0, 10); engine.input(3, 10);
    engine.release(0, 10.4); engine.release(3, 11);
    expect(engine.counts).toEqual({ PERFECT: 1, GREAT: 0, GOOD: 0, MISS: 1 });
    expect(engine.baseScore).toBe(0); expect(engine.combo).toBe(1);
  });
  it('fails a hold that stays pressed beyond the endpoint window without adding points', () => {
    const engine = game(); engine.input(0, 10);
    expect(engine.advance(11.25, held(0))).toEqual([]); expect(engine.baseScore).toBe(0);
    expect(engine.advance(11.2501, held(0))).toMatchObject([{judgement:'MISS'}]);
    expect(engine.baseScore).toBe(0); expect(engine.release(0, 11.3)).toEqual([]);
    expect(engine.counts.MISS).toBe(1);
  });
  it('skips an active hold on forward seek and resets on backwards seek', () => {
    const engine = game([hold(), { id: 2, type: 'tap', time: 15, lane: 3 }]);
    engine.input(0, 10); engine.seek(10.5, false);
    expect(engine.notes[0].state).toBe('skipped'); expect(engine.baseScore).toBe(0); expect(engine.counts.MISS).toBe(0);
    expect(engine.advance(11, held(0))).toEqual([]);
    engine.seek(9.5, true); expect(engine.notes[0].state).toBe('pending'); expect(engine.skipped).toBe(0);
  });
});

describe('hold editing and JSON compatibility', () => {
  it('captures raw endpoints, quantizes both, preserves length on moves and raw endpoints on resize', () => {
    const model = new EditorModel(); model.metadata(120, 10.07);
    const id = model.add(10.149, 0, true, 10.823);
    model.quantize(4, false, true);
    expect(model.selectedNote).toMatchObject({ time: 10.195, endTime: 10.82, sourceTime: 10.149, sourceEndTime: 10.823 });
    model.move(id, 10.3, 2); expect(model.selectedNote).toMatchObject({ time: 10.3, endTime: 10.925 });
    model.resize(id, 11); expect(model.selectedNote).toMatchObject({ endTime: 11, sourceEndTime: 10.823 });
    model.quantize(4, false, true); expect(model.selectedNote).toMatchObject({ time: 10.195, endTime: 10.82 });
    const exported = parseChart(JSON.stringify(model.chart)); expect(exported).toEqual(model.chart);
  });
  it('keeps a short hold at least one subdivision long after quantization', () => {
    const model = new EditorModel(); model.metadata(120, 10); model.add(10.01, 0, true, 10.05);
    model.quantize(4, false, true); expect(model.selectedNote).toMatchObject({ time: 10, endTime: 10.125 });
  });
  it('converts tap/hold, edits endpoints and adds a synchronized second lane as undoable operations', () => {
    const model = new EditorModel(); model.add(10, 0, true); model.changeType('hold', 11);
    model.addChord(3); expect(model.chart.notes).toHaveLength(2); expect(chordGroups(model.chart.notes)).toHaveLength(1);
    expect(model.chart.notes[1]).toMatchObject({ type: 'hold', time: 10, endTime: 11, lane: 3 });
    model.undo(); expect(model.chart.notes).toHaveLength(1);
    model.changeType('tap'); expect(model.selectedNote).toEqual({ id: 1, type: 'tap', time: 10, lane: 0, sourceTime: 10 });
    model.undo(); expect(model.selectedNote?.type).toBe('hold');
    expect(() => model.addChord(0)).toThrow(); model.addChord(3); expect(() => model.addChord(3)).toThrow();
  });
  it('rejects invalid endpoints and preserves the previous chart for invalid edits', () => {
    const model = new EditorModel(); const id = model.add(10, 0, false, 11), before = JSON.stringify(model.chart);
    expect(() => model.resize(id, 10)).toThrow(); expect(() => model.move(id, MAX_TIME, 0)).toThrow();
    expect(() => model.changeType('hold', NaN)).toThrow(); expect(() => model.add(10, 0, false, 9)).toThrow();
    expect(JSON.stringify(model.chart)).toBe(before);
  });
  it.each([undefined, 10, 9, '11', Infinity])('rejects invalid imported hold endpoint case %#', endTime => {
    const chart: Chart = { ...emptyChart(), notes: [{ ...hold(), endTime } as ChartNote] };
    expect(() => parseChart(JSON.stringify(chart))).toThrow();
  });
  it('reads existing tap charts and strips hold-only fields on taps', () => {
    const chart = { ...emptyChart(), notes: [{ id: 1, time: 12, lane: 0, type: 'tap', endTime: 99 }] };
    expect(parseChart(JSON.stringify(chart)).notes[0]).toEqual({ id: 1, time: 12, lane: 0, type: 'tap' });
  });
});

describe('readable sixteenth notes and chords', () => {
  it('keeps heads thinner than sixteenth spacing and scales within available space', () => {
    expect(noteThickness(100, 8, 12)).toBe(4.8);
    expect(noteThickness(50, 100, 12)).toBe(6); expect(noteThickness(150, 100, 12)).toBe(18);
    expect(noteThickness(100, 1, 12)).toBe(2);
    expect(normalizeSettings({}).noteSize).toBe(100); expect(normalizeSettings({ noteSize: 500 }).noteSize).toBe(150);
  });
  it('links only distinct lanes starting together, without transitive grouping across a run', () => {
    expect(chordGroups([hold(0, 1), hold(3, 2, 10.0009)])).toHaveLength(1);
    expect(chordGroups([hold(0, 1), hold(0, 2)])).toHaveLength(0);
    expect(chordGroups([hold(0, 1), hold(3, 2, 10.0009), hold(4, 3, 10.0018)]).map(group => group.map(note => note.id))).toEqual([[1, 2]]);
  });
});
