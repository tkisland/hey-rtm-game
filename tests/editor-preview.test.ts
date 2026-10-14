import { describe, expect, it } from 'vitest';
import { EditorPreview, previewStart } from '../src/editor-preview';
import { emptyChart } from '../src/editor-model';
import type { Chart } from '../src/chart';
const chart: Chart = { ...emptyChart(), notes: [
  { id: 1, lane: 0, type: 'tap', time: 10 },
  { id: 2, lane: 1, type: 'hold', time: 11, endTime: 12 },
  { id: 3, lane: 4, type: 'tap', time: 11 },
  { id: 4, lane: 1, type: 'tap', time: 12 },
] };
function preview() { const result = new EditorPreview(); result.sync(chart); return result; }
describe('editor playback', () => {
  it('plays independent simultaneous starts and ends without changing the chart', () => {
    const original = JSON.stringify(chart), p = preview();
    p.seek(9.9); expect(p.update(10.01, true)).toEqual([{ lane: 0, time: 10, phase: 'tap' }]);
    expect(p.update(10.01, true)).toEqual([]);
    p.seek(10.9); expect(p.update(11.01, true)).toEqual([{ lane: 1, time: 11, phase: 'start' }, { lane: 4, time: 11, phase: 'tap' }]);
    expect(p.notes[1].state).toBe('holding');
    p.update(11.49, true); p.update(11.9, true);
    expect(p.update(12, true)).toEqual([{ lane: 1, time: 12, phase: 'end' }, { lane: 1, time: 12, phase: 'tap' }]);
    expect(p.notes.every(note => note.state === 'hit')).toBe(true);
    expect(JSON.stringify(chart)).toBe(original);
  });
  it('does not repeat a hold start when paused and resumed partway through it', () => {
    const p = preview(); p.seek(10.9); p.update(11.1, true);
    expect(p.update(11.2, false)).toEqual([]);
    expect(p.update(11.2, false)).toEqual([]);
    expect(p.notes[1].state).toBe('holding');
    expect(p.update(11.21, true)).toEqual([]);
    p.update(11.7, true);
    expect(p.update(12.01, true).filter(event => event.phase === 'end')).toHaveLength(1);
  });
  it('resynchronizes seeked and suspended positions without playing skipped notes', () => {
    const p = preview(); p.seek(9);
    expect(p.update(12.2, true)).toEqual([]);
    expect(p.update(10.2, true)).toEqual([]);
    p.seek(11.5); expect(p.update(11.5, true)).toEqual([]);
    expect(p.notes[1].state).toBe('holding');
    expect(p.update(11.8, true)).toEqual([]);
    expect(p.update(12, true)).toHaveLength(2);
  });
  it('rebuilds preview data after editing without changing saved source timestamps', () => {
    const p = preview(); p.seek(9); p.update(10, true);
    const changed = { ...chart, notes: [{ ...chart.notes[0], time: 10.5, sourceTime: 10 }] };
    p.sync(changed); expect(p.update(10.4, false)).toEqual([]);
    expect(p.notes[0].state).toBe('pending');
    expect(p.update(10.51, true)).toEqual([{ lane: 0, time: 10.5, phase: 'tap' }]);
    expect(changed.notes[0].sourceTime).toBe(10);
  });
  it('includes a note at video zero exactly once when explicitly started there', () => {
    const p = new EditorPreview(); p.sync({ ...emptyChart(), notes: [{ id: 1, lane: 2, type: 'tap', time: 0 }] });
    p.seek(0, true);
    expect(p.update(0, true)).toEqual([{ lane: 2, time: 0, phase: 'tap' }]);
    expect(p.update(0.01, true)).toEqual([]);
  });
  it('handles both boundaries of a short hold in one frame, in order', () => {
    const p = new EditorPreview(); p.sync({ ...emptyChart(), notes: [{ id: 1, lane: 2, type: 'hold', time: 10, endTime: 10.03 }] });
    p.seek(9.99);
    expect(p.update(10.04, true).map(event => event.phase)).toEqual(['start', 'end']);
  });
  it('ignores invalid time and accepts an empty chart', () => {
    const p = new EditorPreview(); p.sync(emptyChart()); p.seek(0);
    expect(p.update(0.01, true)).toEqual([]);
    p.sync(chart); p.seek(9.9);
    expect(p.update(NaN, true)).toEqual([]);
    expect(p.update(10, true)).toHaveLength(1);
  });
  it('uses the first note or selection with a travel-time lead-in and retains hold end as the last boundary', () => {
    const p = preview(); expect(p.first).toBe(10); expect(p.end).toBe(12);
    expect(previewStart(undefined, p.first, 2)).toBe(7.5);
    expect(previewStart(chart.notes[1], p.first, 2)).toBe(8.5);
    expect(previewStart(undefined, 1, 2)).toBe(0);
  });
});
