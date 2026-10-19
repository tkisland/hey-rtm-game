import { expect, it } from 'vitest';
import { beatsBetween, beatToTime, bpmAt, snapTime, tempoLabel, timeToBeat } from '../src/tempo';
import { copyChart, EditorModel, emptyChart, parseChart } from '../src/editor-model';
import { bundledChart } from '../src/bundled-charts';
import { BISCUIT_CASE, DEFAULT_SONG } from '../src/songs';
import smg from '../src/charts/smg002.json';

const chart = () => parseChart(JSON.stringify(smg), true);
it('enumerates whole beats through a tempo change without resetting phase or duplicating boundaries', () => {
  const c = { ...emptyChart(), bpm: 120, startTime: 0, beatOrigin: 0, tempoChanges: [{ time: 2.25, bpm: 240 }] };
  expect(beatsBetween(c, 1.5, 3)).toEqual([
    { beat: 3, time: 1.5 }, { beat: 4, time: 2 }, { beat: 5, time: 2.375 },
    { beat: 6, time: 2.625 }, { beat: 7, time: 2.875 },
  ]);
  const lines = beatsBetween(chart(), 18.4, 19.2);
  expect(lines.map(line => line.beat)).toEqual([30, 31, 32]);
  expect(lines[1].time).toBeCloseTo(18.823898469, 8);
  expect(lines[2].time - lines[1].time).toBeCloseTo(60 / 192, 8);
});
it('keeps beats before an arbitrary reference and clips the range at the beginning of the video', () => {
  const c = { ...emptyChart(), bpm: 120, startTime: 12, beatOrigin: 2 };
  expect(beatsBetween(c, -1, .5)).toEqual([{ beat: -4, time: 0 }, { beat: -3, time: .5 }]);
  expect(beatsBetween(c, 1.99, 2.01)).toEqual([{ beat: 0, time: 2 }]);
  expect(beatsBetween(c, 2.1, 2.2)).toEqual([]);
});
it('keeps beat phase at the actual MIDI event between beats, rather than resetting the grid', () => {
  const c = chart();
  expect(timeToBeat(c, 18.626632844)).toBeCloseTo(14577 / 480, 7);
  expect(beatToTime(c, 31)).toBeCloseTo(18.823898469, 8);
  expect(snapTime(c, 18.823898469 + .03, 4)).toBeCloseTo(18.823898469, 8);
  expect(bpmAt(c, 18)).toBeCloseTo(166, 3); expect(bpmAt(c, 19)).toBe(192); expect(tempoLabel(c)).toBe('166 → 192');
  for (const t of [0, 7.65, 18.5, 18.626632844, 50, 100, 210]) expect(beatToTime(c, timeToBeat(c, t))).toBeCloseTo(t, 9);
});
it('preserves tempo metadata through quantize, undo, serialization and independent bundle snapshots', () => {
  const c = chart(), model = new EditorModel(c);
  const note = model.chart.notes.find(n => n.time > 20)!;
  model.move(note.id, note.time + .02, note.lane); model.selected = note.id;
  model.quantize(4, true, false);
  expect(model.selectedNote?.time).toBeCloseTo(note.time, 7);
  expect(model.chart.tempoChanges).toEqual(c.tempoChanges);
  model.undo(); expect(model.selectedNote?.time).toBeCloseTo(note.time + .02, 8);
  expect(parseChart(JSON.stringify(model.chart)).tempoChanges).toEqual(c.tempoChanges);
  const copied = copyChart(c); copied.tempoChanges![0].bpm = 100;
  expect(c.tempoChanges![0].bpm).toBe(192);
  const bundled = bundledChart(DEFAULT_SONG)!; bundled.notes.length = 0; bundled.tempoChanges![0].bpm = 50;
  expect(bundledChart(DEFAULT_SONG)!.notes).toHaveLength(540); expect(bundledChart(DEFAULT_SONG)!.tempoChanges![0].bpm).toBe(192);
});
it('quantizes hold endpoints across a tempo boundary and keeps a short hold at least one subdivision', () => {
  const model = new EditorModel({ ...emptyChart(), bpm: 120, beatOrigin: 0, tempoChanges: [{ time: 2.25, bpm: 240 }] });
  model.add(1.98, 0, true, 2.65); model.quantize(4, false, true);
  expect(model.chart.notes[0]).toMatchObject({ time: 2, endTime: 2.625, sourceTime: 1.98, sourceEndTime: 2.65 });
  const short = new EditorModel({ ...emptyChart(), bpm: 120, beatOrigin: 0, tempoChanges: [{ time: 2, bpm: 240 }] });
  short.add(2.01, 1, true, 2.045); short.quantize(4, false, true);
  expect(short.chart.notes[0]).toMatchObject({ time: 2, endTime: 2.0625 });
});
it('accepts legacy charts and rejects malformed tempo tracks without changing editor state', () => {
  expect(parseChart(JSON.stringify(emptyChart())).tempoChanges).toBeUndefined();
  for (const tempoChanges of [null, {}, [{ time: 18, bpm: 0 }], [{ time: 7.65, bpm: 192 }], [{ time: 18, bpm: 192 }, { time: 17, bpm: 166 }]]) expect(() => parseChart(JSON.stringify({ ...smg, tempoChanges }))).toThrow('テンポ');
  const model = new EditorModel(chart()), before = JSON.stringify(model.chart);
  expect(() => model.metadata(166, 20)).toThrow('拍の基準'); expect(JSON.stringify(model.chart)).toBe(before);
});

it('seeds Biscuit Case quantization from the song map without sharing mutable tempo state', () => {
  const chart = emptyChart(BISCUIT_CASE), second = emptyChart(BISCUIT_CASE);
  expect(chart.tempoChanges).toHaveLength(6);
  expect(parseChart(JSON.stringify(chart), false, BISCUIT_CASE)).toEqual(chart);
  const model = new EditorModel(chart);
  model.add(23.93,0,true);
  model.add(24.51,1,true,24.81);
  model.add(26.96,2,true);
  model.quantize(4,false,true);
  expect(model.chart.notes[0].time).toBeCloseTo(23.95,9);
  expect(model.chart.notes[1]).toMatchObject({sourceTime:24.51,sourceEndTime:24.81});
  expect((model.chart.notes[1] as {endTime:number}).endTime).toBeCloseTo(24.842666754167,9);
  expect(model.chart.notes[2].time).toBeCloseTo(26.964611254167,9);
  for (const [time,bpm] of [[10,200],[50,205.000649169],[105,200],[150,205.000649169],[200,203.000345101],[225,205.000649169],[250,200]]) {
    expect(bpmAt(chart,time)).toBe(bpm);
    const beats = beatsBetween(chart,time,time+1);
    expect(beats[1].time-beats[0].time).toBeCloseTo(60/bpm,9);
  }
  chart.tempoChanges![0].bpm = 240;
  expect(second.tempoChanges![0].bpm).toBe(205.000649169);
  expect(BISCUIT_CASE.tempoChanges![0].bpm).toBe(205.000649169);
});
it('applying or editing a tempo map preserves note/source times, supports undo and rejects bad maps atomically', () => {
  const chart = {...emptyChart(BISCUIT_CASE),tempoChanges:[]};
  const model = new EditorModel(chart);model.add(26.96,2,true,27.5);
  const notes = JSON.stringify(model.chart.notes);
  model.tempoMap(200,3,BISCUIT_CASE.tempoChanges!);
  expect(JSON.stringify(model.chart.notes)).toBe(notes);
  model.undo();expect(model.chart.tempoChanges).toEqual([]);
  model.redo();expect(model.chart.tempoChanges).toHaveLength(6);
  const before = JSON.stringify(model.chart);
  for (const changes of [[{time:3,bpm:205}],[{time:10,bpm:301}],[{time:10,bpm:205},{time:9,bpm:200}],[{time:NaN,bpm:200}],Array.from({length:129},(_,i)=>({time:10+i,bpm:200}))]) {
    expect(()=>model.tempoMap(200,3,changes)).toThrow();
    expect(JSON.stringify(model.chart)).toBe(before);
  }
});
