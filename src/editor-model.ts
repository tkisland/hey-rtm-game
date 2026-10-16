import { copyChart, emptyChart, finite, parseChart, MAX_NOTES, MAX_TIME, MIN_HOLD } from './chart-data';
export { copyChart, emptyChart, parseChart, MAX_NOTES, MAX_TIME, MIN_HOLD } from './chart-data';
import { DEFAULT_SONG } from './songs';
import type { Song } from './songs';
import type { Chart, ChartNote, SlidePoint } from './chart';
import { copyNote } from './chart';
import { beatToTime, snapTime, timeToBeat } from './tempo';
import { boxGroups } from './note-display';

export const EDITOR_KEY = 'hey-rhythm-editor-v1';
export const CUSTOM_CHART_KEY = 'hey-rhythm-custom-chart-v1';
export type Division = 1 | 2 | 4;
export interface TimeRange { start: number; end: number }
export interface NoteClipboard extends TimeRange { notes: ChartNote[] }
export function inRange(note: ChartNote, range: TimeRange): boolean {
  return note.time >= range.start - 1e-8 && note.time < range.end - 1e-8;
}
export function validateRange(range: TimeRange): void {
  if (!finite(range.start, 0, MAX_TIME) || !finite(range.end, 0, MAX_TIME) || range.end <= range.start) throw new Error('範囲の終了は開始より後の0〜7200秒で指定してください。');
}
export function loadChart(key: string, requireNotes = false, song: Song = DEFAULT_SONG): Chart | null {
  try { const value = localStorage.getItem(key); return value ? parseChart(value, requireNotes, song) : null; } catch { return null; }
}
export function storeChart(key: string, chart: Chart): boolean {
  try { localStorage.setItem(key, JSON.stringify(chart)); return true; } catch { return false; }
}
export function quantizeTime(time: number, bpm: number, origin: number, division: Division): number {
  const grid = 60 / bpm / division;
  return Math.min(MAX_TIME, Math.max(0, origin + Math.round((time - origin) / grid) * grid));
}

/** Document snapshots make a drag, quantize, import or single recorded note one undo action. */
export class EditorModel {
  chart: Chart;
  selected: number | null = null;
  private past: Chart[] = [];
  private future: Chart[] = [];
  constructor(chart = emptyChart()) { this.chart = copyChart(chart); }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get selectedNote(): ChartNote | undefined { return this.chart.notes.find(note => note.id === this.selected); }
  private commit(chart: Chart): boolean {
    chart.notes.sort((a, b) => a.time - b.time || a.lane - b.lane || a.id - b.id);
    chart.startTime = chart.notes[0]?.time ?? 0;
    if (chart.notes.some(note => note.gimmick)) parseChart(JSON.stringify(chart), false, {...DEFAULT_SONG, videoId:chart.videoId, title:chart.title});
    if (JSON.stringify(chart) === JSON.stringify(this.chart)) return false;
    this.past.push(this.chart);
    if (this.past.length > 50) this.past.shift();
    this.future = []; this.chart = chart;
    if (!this.selectedNote) this.selected = null;
    return true;
  }
  replace(chart: Chart): boolean { return this.commit(copyChart(chart)); }
  metadata(bpm: number, origin: number): boolean {
    if (!finite(bpm, 40, 300) || !finite(origin, 0, MAX_TIME)) throw new Error('BPMは40〜300、拍の基準は0〜7200秒で指定してください。');
    if (this.chart.tempoChanges?.some(change => change.time <= origin)) throw new Error('拍の基準は最初のテンポ変更より前にしてください。');
    return this.commit({ ...copyChart(this.chart), bpm, beatOrigin: origin });
  }
  add(time: number, lane: number, recorded = false, endTime?: number): number {
    if (!finite(time, 0, MAX_TIME) || !Number.isInteger(lane) || lane < 0 || lane > 5) throw new Error('ノーツの秒数・レーンを確認してください。');
    if (this.chart.notes.length >= MAX_NOTES) throw new Error(`ノーツは最大${MAX_NOTES}個です。`);
    const id = Math.max(0, ...this.chart.notes.map(note => note.id)) + 1;
    if (!Number.isSafeInteger(id)) throw new Error('ノーツIDの上限に達しました。JSONのIDを確認してください。');
    const chart = copyChart(this.chart);
    if (endTime !== undefined && (!finite(endTime, 0, MAX_TIME) || endTime - time < MIN_HOLD - 1e-8)) throw new Error('長推しの終点は始点より30ms以上後にしてください。');
    const base = { id, time, lane, ...(recorded ? { sourceTime: time } : {}) };
    chart.notes.push(endTime === undefined ? { ...base, type: 'tap' } : { ...base, type: 'hold', endTime, ...(recorded ? { sourceEndTime: endTime } : {}) });
    this.commit(chart); this.selected = id;
    return id;
  }
  move(id: number, time: number, lane: number): boolean {
    if (!finite(time, 0, MAX_TIME) || !Number.isInteger(lane) || lane < 0 || lane > 5) throw new Error('ノーツの秒数・レーンを確認してください。');
    const chart = copyChart(this.chart), note = chart.notes.find(note => note.id === id);
    if (!note) return false;
    if (note.gimmick === 'box') {
      const delta = time - note.time;
      for (const member of chart.notes) if (member.boxId === note.boxId) {
        if (!finite(member.time + delta, 0, MAX_TIME)) throw new Error('箱推し全体が0〜7200秒に収まる位置にしてください。');
        member.time += delta;
      }
      return this.commit(chart);
    }
    if (note.type === 'hold') {
      const end = note.endTime + time - note.time;
      if (end > MAX_TIME) throw new Error('長推しの終点は7200秒以内にしてください。');
      note.endTime = end;
    }
    if (note.path) {
      const path = note.path.map(point => ({time:point.time + time - note.time, lane:point.lane + lane - note.lane}));
      if (path.some(point => point.lane < 0 || point.lane > 5)) throw new Error('推し変の移動先が6レーン内に収まる位置にしてください。');
      note.path = path;
    }
    note.time = time; note.lane = lane;
    return this.commit(chart);
  }
  changeType(type: 'tap' | 'hold' | 'dd' | 'slide', endTime?: number): boolean {
    const current = this.selectedNote; if (!current) return false;
    if ((type === 'hold' || type === 'slide') && (!finite(endTime, 0, MAX_TIME) || endTime - current.time < MIN_HOLD - 1e-8)) throw new Error('長推しの終点は始点より30ms以上後にしてください。');
    const chart = copyChart(this.chart);
    if (current.boxId) this.dissolveBox(chart.notes, current.boxId);
    chart.notes = chart.notes.map(note => {
      if (note.id !== current.id) return note;
      const base = { id: note.id, time: note.time, lane: note.lane, ...(note.sourceTime === undefined ? {} : { sourceTime: note.sourceTime }) };
      if (type === 'tap' || type === 'dd') return {...base, type:'tap', ...(type === 'dd' ? {gimmick:'dd' as const} : {})};
      return {...base, type:'hold', endTime:endTime!, ...(type === 'slide' ? {gimmick:'slide' as const, path:note.path ?? [{time:(note.time + endTime!) / 2, lane:note.lane === 5 ? 4 : note.lane + 1}]} : {}), ...(note.type === 'hold' && note.sourceEndTime !== undefined ? {sourceEndTime:note.sourceEndTime} : {})};
    });
    return this.commit(chart);
  }
  resize(id: number, endTime: number): boolean {
    const chart = copyChart(this.chart), note = chart.notes.find(n => n.id === id);
    if (!note || note.type !== 'hold') return false;
    if (!finite(endTime, 0, MAX_TIME) || endTime - note.time < MIN_HOLD - 1e-8) throw new Error('長推しの終点は始点より30ms以上後にしてください。');
    note.endTime = endTime; return this.commit(chart);
  }
  addChord(lane: number): boolean {
    const note = this.selectedNote;
    if (!note) throw new Error('先にノーツを選択してください。');
    if (!Number.isInteger(lane) || lane < 0 || lane > 5 || lane === note.lane) throw new Error('同時推しは別のレーンを選んでください。');
    if (this.chart.notes.some(other => other.lane === lane && Math.abs(other.time - note.time) <= 0.001)) throw new Error('選択したレーンには同じ時刻のノーツがあります。');
    if (this.chart.notes.length >= MAX_NOTES) throw new Error(`ノーツは最大${MAX_NOTES}個です。`);
    const id = Math.max(0, ...this.chart.notes.map(n => n.id)) + 1;
    if (!Number.isSafeInteger(id)) throw new Error('ノーツIDの上限に達しました。');
    if (note.gimmick) throw new Error('同時推しを追加するには通常の単推し・長推しを選んでください。');
    const chart = copyChart(this.chart); chart.notes.push({ ...note, id, lane });
    return this.commit(chart);
  }
  private dissolveBox(notes: ChartNote[], boxId: number): void {
    for (const note of notes) if (note.boxId === boxId) { delete note.gimmick; delete note.boxId; }
  }
  private completeBoxes(notes: ChartNote[]): ChartNote[] {
    const ids = new Set(notes.flatMap(note => note.boxId ? [note.boxId] : []));
    for (const id of ids) if (notes.filter(note => note.boxId === id).length !== 6) this.dissolveBox(notes, id);
    return notes;
  }
  setSlidePath(path: SlidePoint[]): boolean {
    const chart = copyChart(this.chart), note = chart.notes.find(note => note.id === this.selected);
    if (!note || note.gimmick !== 'slide') return false;
    note.path = path.map(point => ({...point})); return this.commit(chart);
  }
  boxRange(range: TimeRange): boolean {
    validateRange(range);
    const chart = copyChart(this.chart), notes = chart.notes.filter(note => inRange(note, range));
    if (notes.length !== 6 || notes.some(note => note.type !== 'tap' || note.gimmick)) throw new Error('通常の単推し6個を、6色1個ずつ含む範囲を選んでください。');
    const boxId = Math.max(0, ...chart.notes.map(note => note.boxId ?? 0)) + 1;
    const first = Math.min(...notes.map(note => note.time));
    for (const note of notes) { note.gimmick = 'box'; note.boxId = boxId; note.sourceTime ??= note.time; note.time = first; }
    return this.commit(chart);
  }
  remove(): boolean { const chart = copyChart(this.chart); const boxId = this.selectedNote?.gimmick === 'box' ? this.selectedNote.boxId : undefined; chart.notes = this.completeBoxes(chart.notes.filter(note => boxId ? note.boxId !== boxId : note.id !== this.selected)); return this.commit(chart); }
  copyRange(range: TimeRange): NoteClipboard {
    validateRange(range);
    const notes = this.completeBoxes(this.chart.notes.filter(note => inRange(note, range)).map(copyNote));
    if (!notes.length) throw new Error('選択範囲にノーツがありません。');
    return { ...range, notes };
  }
  removeRange(range: TimeRange): number {
    validateRange(range);
    const notes = this.completeBoxes(this.chart.notes.filter(note => !inRange(note, range)).map(copyNote));
    const removed = this.chart.notes.length - notes.length;
    if (removed) this.commit({ ...copyChart(this.chart), notes });
    return removed;
  }
  pasteRange(clipboard: NoteClipboard, at: number): number {
    validateRange(clipboard);
    if (!finite(at, 0, MAX_TIME) || at + clipboard.end - clipboard.start > MAX_TIME + 1e-8) throw new Error('貼り付けた範囲が0〜7200秒に収まる位置を指定してください。');
    if (!clipboard.notes.length) throw new Error('先に範囲をコピーしてください。');
    if (this.chart.notes.length + clipboard.notes.length > MAX_NOTES) throw new Error(`ノーツは最大${MAX_NOTES}個です。`);
    const firstId = Math.max(0, ...this.chart.notes.map(note => note.id)) + 1;
    if (!Number.isSafeInteger(firstId + clipboard.notes.length - 1)) throw new Error('ノーツIDの上限に達しました。');
    const delta = at - clipboard.start;
    const boxIds = new Map<number, number>();
    let boxId = Math.max(0, ...this.chart.notes.map(note => note.boxId ?? 0));
    const pasted = clipboard.notes.map((original, i) => {
      const note = { ...copyNote(original), id: firstId + i, time: Math.max(0, original.time + delta) };
      if (note.boxId) { if (!boxIds.has(note.boxId)) boxIds.set(note.boxId, ++boxId); note.boxId = boxIds.get(note.boxId)!; }
      if (note.path) note.path = note.path.map(point => ({...point, time:point.time + delta}));
      if (note.type === 'hold') note.endTime += delta;
      if (note.time > MAX_TIME + 1e-8 || (note.type === 'hold' && note.endTime > MAX_TIME + 1e-8)) throw new Error('長推しの終点も含め、7200秒以内に貼り付けてください。');
      note.time = Math.min(MAX_TIME, note.time); if (note.type === 'hold') note.endTime = Math.min(MAX_TIME, note.endTime);
      if (note.sourceTime !== undefined) note.sourceTime += delta;
      if (note.type === 'hold' && note.sourceEndTime !== undefined) note.sourceEndTime += delta;
      // The playable times stay intact when provenance would fall outside the document.
      if ((note.sourceTime !== undefined && !finite(note.sourceTime, 0, MAX_TIME)) ||
        (note.type === 'hold' && note.sourceEndTime !== undefined && !finite(note.sourceEndTime, 0, MAX_TIME))) {
        delete note.sourceTime; if (note.type === 'hold') delete note.sourceEndTime;
      }
      return note;
    });
    this.commit({ ...copyChart(this.chart), notes: [...this.chart.notes, ...pasted] }); this.selected = null;
    return pasted.length;
  }
  quantize(division: Division, selectedOnly: boolean, fromSource: boolean): boolean {
    const chart = copyChart(this.chart);
    chart.notes.forEach(note => {
      if (note.gimmick === 'box') return;
      if (selectedOnly && note.id !== this.selected) return;
      const start = snapTime(chart, fromSource ? note.sourceTime ?? note.time : note.time, division);
      if (note.type === 'hold') {
        let end = snapTime(chart, fromSource ? note.sourceEndTime ?? note.endTime : note.endTime, division);
        // Short captures keep at least one subdivision rather than collapsing to a tap.
        if (end - start < MIN_HOLD) end = beatToTime(chart, timeToBeat(chart, start) + 1 / division);
        if (end > MAX_TIME) throw new Error('クオンタイズ後の長推しの終点が7200秒を超えます。');
        note.endTime = end;
      }
      if (note.path) note.path = note.path.map(point => ({...point, time:snapTime(chart, point.time, division)}));
      note.time = start;
    });
    for (const group of boxGroups(chart.notes)) {
      if (selectedOnly && !group.some(note => note.id === this.selected)) continue;
      const anchor = Math.min(...group.map(note => fromSource ? note.sourceTime ?? note.time : note.time));
      const snapped = snapTime(chart, anchor, division);
      group.forEach(note => { note.time = snapped; });
    }
    return this.commit(chart);
  }
  undo(): boolean {
    const previous = this.past.pop(); if (!previous) return false;
    this.future.push(this.chart); this.chart = previous;
    if (!this.selectedNote) this.selected = null;
    return true;
  }
  redo(): boolean {
    const next = this.future.pop(); if (!next) return false;
    this.past.push(this.chart); this.chart = next;
    if (!this.selectedNote) this.selected = null;
    return true;
  }
}
