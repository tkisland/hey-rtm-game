import { expect, it } from 'vitest';
import { EditorModel, emptyChart, MAX_NOTES, MAX_TIME, parseChart } from '../src/editor-model';

const chart = () => ({ ...emptyChart(), bpm: 120, notes: [
  { id: 1, lane: 1, time: 9, endTime: 10.5, type: 'hold' as const },
  { id: 2, lane: 0, time: 10.25, sourceTime: 10.2, type: 'tap' as const },
  { id: 3, lane: 5, time: 10.25, type: 'tap' as const },
  { id: 4, lane: 2, time: 11, endTime: 13, sourceTime: 10.99, sourceEndTime: 13.02, type: 'hold' as const },
  { id: 5, lane: 4, time: 12, type: 'tap' as const },
] });
const range = { start: 10, end: 12 };
it('selects all lanes by note start with an exclusive end and keeps complete holds', () => {
  const model = new EditorModel(chart()), before = JSON.stringify(model.chart);
  const copy = model.copyRange(range);
  expect(copy.notes.map(note => note.id)).toEqual([2, 3, 4]);
  expect(copy.notes[2]).toMatchObject({ time: 11, endTime: 13 });
  expect(JSON.stringify(model.chart)).toBe(before); expect(model.canUndo).toBe(false);
});
it('preserves leading rests, chords, hold lengths and shifted source times with new IDs', () => {
  const model = new EditorModel(chart()), before = JSON.stringify(model.chart), copy = model.copyRange(range);
  expect(model.pasteRange(copy, 20)).toBe(3);
  expect(model.chart.notes.filter(note => note.id > 5)).toEqual([
    { id: 6, lane: 0, time: 20.25, sourceTime: 20.2, type: 'tap' },
    { id: 7, lane: 5, time: 20.25, type: 'tap' },
    expect.objectContaining({ id: 8, lane: 2, time: 21, endTime: 23, sourceEndTime: 23.02, type: 'hold' }),
  ]);
  expect(model.chart.notes.at(-1)?.sourceTime).toBeCloseTo(20.99);
  expect(parseChart(JSON.stringify(model.chart)).notes).toEqual(model.chart.notes);
  expect(model.undo()).toBe(true); expect(JSON.stringify(model.chart)).toBe(before);
  expect(model.redo()).toBe(true); expect(model.chart.notes).toHaveLength(8);
});
it('copies a snapshot that survives source edits, deletion and repeated paste', () => {
  const model = new EditorModel(chart()), copy = model.copyRange(range);
  model.move(2, 30, 3); model.removeRange({ start: 0, end: 40 });
  model.pasteRange(copy, 0); model.pasteRange(copy, 4);
  expect(model.chart.notes.map(note => note.time)).toEqual([0.25, 0.25, 1, 4.25, 4.25, 5]);
  expect(new Set(model.chart.notes.map(note => note.id)).size).toBe(6);
  expect(copy.notes.map(note => note.time)).toEqual([10.25, 10.25, 11]);
});
it('deletes a range as one undo action, keeps overlapping earlier holds, and ignores an empty range', () => {
  const model = new EditorModel(chart()), before = JSON.stringify(model.chart);
  expect(model.removeRange(range)).toBe(3); expect(model.chart.notes.map(note => note.id)).toEqual([1, 5]);
  model.undo(); expect(JSON.stringify(model.chart)).toBe(before);
  const fresh = new EditorModel(chart()); expect(fresh.removeRange({ start: 30, end: 31 })).toBe(0); expect(fresh.canUndo).toBe(false);
});
it('can paste at zero without invalid provenance and retains current note timing', () => {
  const model = new EditorModel({ ...emptyChart(), notes: [{ id: 1, lane: 0, time: 1, type: 'hold', endTime: 2, sourceTime: 0.99, sourceEndTime: 1.99 }] });
  model.pasteRange(model.copyRange({ start: 1, end: 2 }), 0);
  expect(model.chart.notes[0]).toEqual({ id: 2, lane: 0, time: 0, endTime: 1, type: 'hold' });
  expect(() => parseChart(JSON.stringify(model.chart))).not.toThrow();
});
it('rejects invalid or oversized paste atomically, including a tail beyond the selected range', () => {
  const model = new EditorModel(chart()), before = JSON.stringify(model.chart), copy = model.copyRange(range);
  for (const at of [-1, NaN, Infinity, MAX_TIME - 2]) expect(() => model.pasteRange(copy, at)).toThrow();
  for (const bad of [{ start: 12, end: 10 }, { start: 10, end: 10 }, { start: NaN, end: 20 }, { start: 0, end: MAX_TIME + 1 }]) {
    expect(() => model.copyRange(bad)).toThrow(); expect(() => model.removeRange(bad)).toThrow();
  }
  expect(() => model.copyRange({ start: 20, end: 21 })).toThrow();
  expect(model.canUndo).toBe(false); expect(JSON.stringify(model.chart)).toBe(before);
  const full = new EditorModel({ ...emptyChart(), notes: Array.from({ length: MAX_NOTES }, (_, i) => ({ id: i + 1, lane: 0, time: 1, type: 'tap' })) });
  expect(() => full.pasteRange(copy, 20)).toThrow(); expect(full.canUndo).toBe(false);
  const ids = new EditorModel({ ...emptyChart(), notes: [{ id: Number.MAX_SAFE_INTEGER, lane: 0, time: 1, type: 'tap' }] });
  expect(() => ids.pasteRange(copy, 20)).toThrow(); expect(ids.canUndo).toBe(false);
});
