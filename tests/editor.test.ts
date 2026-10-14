import { describe, expect, it, vi, afterEach } from 'vitest';
import { VIDEO_ID } from '../src/chart';
import { CUSTOM_CHART_KEY, EditorModel, MAX_TIME, emptyChart, loadChart, parseChart, quantizeTime, storeChart } from '../src/editor-model';

const document = () => {
  const model = new EditorModel(); model.metadata(120, 10.07);
  model.add(10.149, 0, true); model.add(10.204, 3, true);
  return model;
};
afterEach(() => vi.unstubAllGlobals());
describe('editor timing and reversible changes', () => {
  it('quantizes relative to the beat origin at quarter, eighth and sixteenth precision', () => {
    expect(quantizeTime(10.28, 120, 10.07, 1)).toBeCloseTo(10.07);
    expect(quantizeTime(10.28, 120, 10.07, 2)).toBeCloseTo(10.32);
    expect(quantizeTime(10.28, 120, 10.07, 4)).toBeCloseTo(10.32);
    expect(quantizeTime(9.943, 120, 10.07, 4)).toBeCloseTo(9.945);
    expect(quantizeTime(0, 120, 0.43, 1)).toBe(0);
    expect(quantizeTime(MAX_TIME, 120, 0.07, 1)).toBeLessThanOrEqual(MAX_TIME);
  });
  it('preserves original input through quantization, manual movement, and requantization', () => {
    const model = document();
    model.quantize(4, false, true);
    expect(model.chart.notes.map(n => n.time)).toEqual([10.195, 10.195]);
    const id = model.chart.notes[0].id;
    model.move(id, 10.4, 2);
    expect(model.chart.notes.find(n => n.id === id)?.sourceTime).toBe(10.149);
    model.quantize(4, false, true);
    expect(model.chart.notes.find(n => n.id === id)?.time).toBeCloseTo(10.195);
    expect(model.chart.notes.find(n => n.id === id)?.lane).toBe(2);
    model.metadata(120, 10);
    model.quantize(4, false, true);
    expect(model.chart.notes.find(n => n.id === id)?.time).toBeCloseTo(10.125);
  });
  it('allows quantization from current edits, and limits the operation to a selected note', () => {
    const model = document(), id = model.chart.notes[0].id;
    model.selected = id; model.move(id, 10.45, 1);
    model.quantize(4, true, false);
    expect(model.selectedNote?.time).toBeCloseTo(10.445);
    expect(model.chart.notes.find(n => n.id !== id)?.time).toBe(10.204);
  });
  it('keeps all same-time notes including same-lane overlaps instead of silently losing inputs', () => {
    const model = new EditorModel(); model.metadata(120, 0);
    model.add(1.01, 0, true); model.add(1.02, 0, true); model.add(1.03, 3, true);
    model.quantize(4, false, true);
    expect(model.chart.notes).toHaveLength(3);
    expect(model.chart.notes.map(n => n.time)).toEqual([1, 1, 1]);
    expect(new Set(model.chart.notes.map(n => n.id)).size).toBe(3);
  });
  it('undoes and redoes quantization as one action, and clears redo after a new edit', () => {
    const model = document(), before = JSON.stringify(model.chart);
    model.quantize(4, false, true); const quantized = JSON.stringify(model.chart);
    expect(model.undo()).toBe(true); expect(JSON.stringify(model.chart)).toBe(before);
    expect(model.redo()).toBe(true); expect(JSON.stringify(model.chart)).toBe(quantized);
    model.undo(); model.add(12, 5);
    expect(model.canRedo).toBe(false); expect(model.redo()).toBe(false);
  });
  it('supports undoing delete, import, and clearing the chart without mutating prior states', () => {
    const model = document(), before = JSON.stringify(model.chart);
    model.remove(); expect(model.chart.notes).toHaveLength(1); model.undo();
    expect(JSON.stringify(model.chart)).toBe(before);
    model.replace(emptyChart()); expect(model.chart.notes).toHaveLength(0); model.undo();
    expect(JSON.stringify(model.chart)).toBe(before);
    const exported = parseChart(before); exported.notes[0].time = 4;
    model.replace(exported); expect(model.chart.startTime).toBe(4); model.undo();
    expect(JSON.stringify(model.chart)).toBe(before);
  });
  it('starts playback at the first actual note independently of the beat reference', () => {
    const model = new EditorModel(); model.metadata(120, 10);
    model.add(15, 2); model.add(12, 3);
    expect(model.chart.startTime).toBe(12); expect(model.chart.beatOrigin).toBe(10);
    expect(model.chart.notes.map(n => n.time)).toEqual([12, 15]);
    model.move(model.chart.notes[0].id, 20, 4); expect(model.chart.startTime).toBe(15);
  });
  it('rejects invalid edits without affecting the active document or history', () => {
    const model = document(), before = JSON.stringify(model.chart);
    expect(() => model.add(NaN, 0)).toThrow(); expect(() => model.add(1, 6)).toThrow();
    expect(() => model.metadata(0, 0)).toThrow(); expect(() => model.move(1, -1, 1)).toThrow();
    expect(JSON.stringify(model.chart)).toBe(before);
  });
});
describe('chart import and browser storage', () => {
  it('round-trips raw timestamps, metadata and simultaneous notes, and supports older charts', () => {
    const chart = document().chart;
    expect(parseChart(JSON.stringify(chart))).toEqual(chart);
    const legacy = { videoId: VIDEO_ID, title: 'Song', bpm: 140, startTime: 12, notes: [{ id: 1, time: 12, lane: 0, type: 'tap' }] };
    expect(parseChart(JSON.stringify(legacy)).beatOrigin).toBe(12);
  });
  it.each([
    { bpm: 0 }, { bpm: 301 }, { videoId: 'other-video' }, { beatOrigin: -1 },
    { notes: [{ id: 1, time: '12', lane: 0, type: 'tap' }] },
    { notes: [{ id: 1, time: 12, lane: 6, type: 'tap' }] },
    { notes: [{ id: 1, time: 12, lane: 0, type: 'hold' }] },
    { notes: [{ id: 1, time: 12, lane: 0, type: 'tap', sourceTime: -1 }] },
    { notes: Array.from({ length: 2 }, () => ({ id: 1, time: 12, lane: 0, type: 'tap' })) },
    { notes: Array.from({ length: 5001 }, (_, i) => ({ id: i + 1, time: 12, lane: 0, type: 'tap' })) },
  ])('rejects malformed or unsupported imported fields case %#', patch => {
    expect(() => parseChart(JSON.stringify({ ...emptyChart(), ...patch }))).toThrow();
  });
  it('rejects oversized/invalid JSON and empty playable charts', () => {
    expect(() => parseChart('{')).toThrow(); expect(() => parseChart(' '.repeat(1024 * 1024 + 1))).toThrow();
    expect(() => parseChart(JSON.stringify(emptyChart()), true)).toThrow();
    expect(parseChart(JSON.stringify(emptyChart()))).toEqual(emptyChart());
  });
  it('falls back safely on corrupted/unavailable storage and reports a failed write', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{', setItem: () => { throw new Error('quota'); } });
    expect(loadChart(CUSTOM_CHART_KEY, true)).toBeNull(); expect(storeChart(CUSTOM_CHART_KEY, emptyChart())).toBe(false);
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(document().chart), setItem: vi.fn() });
    expect(loadChart(CUSTOM_CHART_KEY, true)?.notes).toHaveLength(2);
    expect(storeChart(CUSTOM_CHART_KEY, emptyChart())).toBe(true);
  });
});
