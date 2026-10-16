import { DEFAULT_SONG } from './songs';
import type { Song } from './songs';
import type { Chart, ChartNote } from './chart';

export const MAX_NOTES = 5000;
export const MAX_TIME = 7200;
export const MIN_HOLD = 0.03;
const MAX_JSON_BYTES = 1024 * 1024;

export const copyChart = (chart: Chart): Chart => ({ ...chart, ...(chart.tempoChanges ? { tempoChanges: chart.tempoChanges.map(change => ({ ...change })) } : {}), notes: chart.notes.map(note => ({ ...note })) });
export const emptyChart = (song: Song = DEFAULT_SONG): Chart => ({ videoId: song.videoId, title: song.title, bpm: song.bpm, startTime: 0, beatOrigin: song.startTime, notes: [] });
export const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Validate before replacing a document. Ignore unknown properties; never trust imported HTML. */
export function parseChart(text: string, requireNotes = false, song: Song = DEFAULT_SONG): Chart {
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) throw new Error('JSONは1MB以内にしてください。');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('JSONの形式を確認してください。'); }
  if (!object(value) || value.videoId !== song.videoId) throw new Error(`選択中の「${song.title}」と動画IDが一致する譜面を読み込んでください。`);
  if (typeof value.title !== 'string' || value.title.length > 200 || !finite(value.bpm, 40, 300) || !finite(value.startTime, 0, MAX_TIME)) throw new Error('タイトル・BPM（40〜300）・開始時刻を確認してください。');
  if (value.beatOrigin !== undefined && !finite(value.beatOrigin, 0, MAX_TIME)) throw new Error('拍の基準時刻を確認してください。');
  const tempoChanges: { time: number; bpm: number }[] = [];
  if (value.tempoChanges !== undefined) {
    if (!Array.isArray(value.tempoChanges) || value.tempoChanges.length > 128) throw new Error('テンポ変更は時刻順に128件以内で指定してください。');
    let previous = value.beatOrigin ?? value.startTime;
    for (const change of value.tempoChanges) {
      if (!object(change) || !finite(change.time, 0, MAX_TIME) || change.time <= previous || !finite(change.bpm, 40, 300)) throw new Error('テンポ変更は拍の基準より後の時刻順、BPM40〜300で指定してください。');
      tempoChanges.push({ time: change.time, bpm: change.bpm }); previous = change.time;
    }
  }
  if (!Array.isArray(value.notes) || value.notes.length > MAX_NOTES || (requireNotes && !value.notes.length)) throw new Error(`ノーツ数は${requireNotes ? '1' : '0'}〜${MAX_NOTES}個にしてください。`);
  const ids = new Set<number>();
  const notes: ChartNote[] = value.notes.map(item => {
    if (!object(item) || !Number.isSafeInteger(item.id) || (item.id as number) < 1 || ids.has(item.id as number) || !finite(item.time, 0, MAX_TIME) || !Number.isInteger(item.lane) || !finite(item.lane, 0, 5) || (item.type !== 'tap' && item.type !== 'hold') || (item.sourceTime !== undefined && !finite(item.sourceTime, 0, MAX_TIME))) throw new Error('ノーツのID（一意の正整数）・秒数・レーン（0〜5）・typeを確認してください。');
    ids.add(item.id as number);
    const base = { id: item.id as number, time: item.time, lane: item.lane, ...(item.sourceTime === undefined ? {} : { sourceTime: item.sourceTime }) };
    if (item.type === 'hold') {
      if (!finite(item.endTime, 0, MAX_TIME) || item.endTime - item.time < MIN_HOLD - 1e-8 || (item.sourceEndTime !== undefined && (!finite(item.sourceEndTime, 0, MAX_TIME) || item.sourceEndTime <= (item.sourceTime ?? item.time)))) throw new Error('長押しの終点は始点より30ms以上後にしてください。');
      return { ...base, type: 'hold', endTime: item.endTime, ...(item.sourceEndTime === undefined ? {} : { sourceEndTime: item.sourceEndTime }) };
    }
    return { ...base, type: 'tap' };
  });
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane || a.id - b.id);
  return { videoId: song.videoId, title: value.title, bpm: value.bpm, startTime: notes[0]?.time ?? value.startTime, beatOrigin: value.beatOrigin ?? value.startTime, ...(value.tempoChanges === undefined ? {} : { tempoChanges }), notes };
}
