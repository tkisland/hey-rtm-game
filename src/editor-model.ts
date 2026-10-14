import { VIDEO_ID } from './chart';
import type { Chart, TapNote } from './chart';

export const EDITOR_KEY = 'hey-rhythm-editor-v1';
export const CUSTOM_CHART_KEY = 'hey-rhythm-custom-chart-v1';
export const MAX_NOTES = 5000;
export const MAX_TIME = 7200;
const MAX_JSON_BYTES = 1024 * 1024;
export type Division = 1 | 2 | 4;
export const copyChart = (chart: Chart): Chart => ({ ...chart, notes: chart.notes.map(note => ({ ...note })) });
export const emptyChart = (): Chart => ({ videoId: VIDEO_ID, title: 'SUPER MOMMY GIRLS', bpm: 140, startTime: 0, beatOrigin: 12, notes: [] });
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Validate before replacing a document. Ignore unknown properties; never trust imported HTML. */
export function parseChart(text: string, requireNotes = false): Chart {
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) throw new Error('JSONは1MB以内にしてください。');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('JSONの形式を確認してください。'); }
  if (!object(value) || value.videoId !== VIDEO_ID) throw new Error('このエディターはSUPER MOMMY GIRLSの動画IDに対応しています。');
  if (typeof value.title !== 'string' || value.title.length > 200 || !finite(value.bpm, 40, 300) || !finite(value.startTime, 0, MAX_TIME)) throw new Error('タイトル・BPM（40〜300）・開始時刻を確認してください。');
  if (value.beatOrigin !== undefined && !finite(value.beatOrigin, 0, MAX_TIME)) throw new Error('拍の基準時刻を確認してください。');
  if (!Array.isArray(value.notes) || value.notes.length > MAX_NOTES || (requireNotes && !value.notes.length)) throw new Error(`ノーツ数は${requireNotes ? '1' : '0'}〜${MAX_NOTES}個にしてください。`);
  const ids = new Set<number>();
  const notes: TapNote[] = value.notes.map(item => {
    if (!object(item) || !Number.isSafeInteger(item.id) || (item.id as number) < 1 || ids.has(item.id as number) || !finite(item.time, 0, MAX_TIME) || !Number.isInteger(item.lane) || !finite(item.lane, 0, 5) || item.type !== 'tap' || (item.sourceTime !== undefined && !finite(item.sourceTime, 0, MAX_TIME))) throw new Error('ノーツのID（一意の正整数）・秒数・レーン（0〜5）・typeを確認してください。');
    ids.add(item.id as number);
    return { id: item.id as number, time: item.time, lane: item.lane, type: 'tap', ...(item.sourceTime === undefined ? {} : { sourceTime: item.sourceTime }) };
  });
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane || a.id - b.id);
  return { videoId: VIDEO_ID, title: value.title, bpm: value.bpm, startTime: notes[0]?.time ?? value.startTime, beatOrigin: value.beatOrigin ?? value.startTime, notes };
}
export function loadChart(key: string, requireNotes = false): Chart | null {
  try { const value = localStorage.getItem(key); return value ? parseChart(value, requireNotes) : null; } catch { return null; }
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
  get selectedNote(): TapNote | undefined { return this.chart.notes.find(note => note.id === this.selected); }
  private commit(chart: Chart): boolean {
    chart.notes.sort((a, b) => a.time - b.time || a.lane - b.lane || a.id - b.id);
    chart.startTime = chart.notes[0]?.time ?? 0;
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
    return this.commit({ ...copyChart(this.chart), bpm, beatOrigin: origin });
  }
  add(time: number, lane: number, recorded = false): number {
    if (!finite(time, 0, MAX_TIME) || !Number.isInteger(lane) || lane < 0 || lane > 5) throw new Error('ノーツの秒数・レーンを確認してください。');
    if (this.chart.notes.length >= MAX_NOTES) throw new Error(`ノーツは最大${MAX_NOTES}個です。`);
    const id = Math.max(0, ...this.chart.notes.map(note => note.id)) + 1;
    if (!Number.isSafeInteger(id)) throw new Error('ノーツIDの上限に達しました。JSONのIDを確認してください。');
    const chart = copyChart(this.chart);
    chart.notes.push({ id, time, lane, type: 'tap', ...(recorded ? { sourceTime: time } : {}) });
    this.commit(chart); this.selected = id;
    return id;
  }
  move(id: number, time: number, lane: number): boolean {
    if (!finite(time, 0, MAX_TIME) || !Number.isInteger(lane) || lane < 0 || lane > 5) throw new Error('ノーツの秒数・レーンを確認してください。');
    const chart = copyChart(this.chart), note = chart.notes.find(note => note.id === id);
    if (!note) return false;
    note.time = time; note.lane = lane;
    return this.commit(chart);
  }
  remove(): boolean { return this.commit({ ...copyChart(this.chart), notes: this.chart.notes.filter(note => note.id !== this.selected) }); }
  quantize(division: Division, selectedOnly: boolean, fromSource: boolean): boolean {
    const chart = copyChart(this.chart);
    chart.notes.forEach(note => {
      if (!selectedOnly || note.id === this.selected) note.time = quantizeTime(fromSource ? note.sourceTime ?? note.time : note.time, chart.bpm, chart.beatOrigin ?? chart.startTime, division);
    });
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
