import { DEFAULT_SONG } from './songs';
import type { Song } from './songs';

interface NoteBase {
  id: number;
  /** Absolute time in seconds from the beginning of the video. */
  time: number;
  lane: number;
  /** Original recorded timestamp; retained through quantization and manual edits. */
  sourceTime?: number;
}
export interface TapNote extends NoteBase { type: 'tap' }
export interface HoldNote extends NoteBase {
  type: 'hold';
  endTime: number;
  sourceEndTime?: number;
}
export type ChartNote = TapNote | HoldNote;
export interface Chart {
  videoId: string;
  title: string;
  bpm: number;
  startTime: number;
  /** Video timestamp of a reference quarter-note beat, independent of the first note. */
  beatOrigin?: number;
  notes: ChartNote[];
}
export const VIDEO_ID = DEFAULT_SONG.videoId;
export const TEST_DURATION = 30;

/** A deterministic practice pattern, not a transcription of the song. */
export function generateChart(bpm = DEFAULT_SONG.bpm, startTime = DEFAULT_SONG.startTime, song: Song = DEFAULT_SONG): Chart {
  const beat = 60 / bpm;
  const notes: ChartNote[] = [];
  const lanes = [0, 2, 4, 1, 3, 5, 2, 0, 5, 3, 1, 4];
  const lastTime = Array<number>(6).fill(-Infinity);
  const add = (relativeBeat: number, preferredLane: number, holdBeats = 0) => {
    if (relativeBeat * beat >= TEST_DURATION) return;
    const time = startTime + relativeBeat * beat;
    // Keep even high-BPM practice comfortable: dense subdivisions change fingers.
    const lane = Array.from({ length: 6 }, (_, i) => (preferredLane + i) % 6)
      .find(candidate => time - lastTime[candidate] >= 0.3 - 1e-8);
    if (lane === undefined) return;
    const endTime = time + holdBeats * beat;
    const long = holdBeats > 0 && endTime < startTime + TEST_DURATION;
    lastTime[lane] = long ? endTime : time;
    notes.push(long ? { id: 0, time, endTime, lane, type: 'hold' } : { id: 0, time, lane, type: 'tap' });
  };
  for (let b = 0; b * beat < TEST_DURATION; b++) {
    const lane = lanes[b % lanes.length];
    add(b, lane, b % 16 === 8 ? 1 : 0);
    if (b % 8 === 4) add(b, (lane + 3) % 6);
    if (b % 4 === 1) add(b + 0.5, (lane + 2) % 6);
    if (b % 16 === 11) add(b + 0.75, (lane + 4) % 6);
  }
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  notes.forEach((note, i) => { note.id = i + 1; });
  return { videoId: song.videoId, title: song.title, bpm, startTime, notes };
}
