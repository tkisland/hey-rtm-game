export interface TapNote {
  id: number;
  /** Absolute time in seconds from the beginning of the video. */
  time: number;
  lane: number;
  type: 'tap';
}
export interface Chart {
  videoId: string;
  title: string;
  bpm: number;
  startTime: number;
  notes: TapNote[];
}
export const VIDEO_ID = 'pJDfWpZ7CI4';
export const TEST_DURATION = 30;

/** A deterministic practice pattern, not a transcription of the song. */
export function generateChart(bpm = 140, startTime = 12): Chart {
  const beat = 60 / bpm;
  const notes: TapNote[] = [];
  const lanes = [0, 2, 4, 1, 3, 5, 2, 0, 5, 3, 1, 4];
  const lastTime = Array<number>(6).fill(-Infinity);
  const add = (relativeBeat: number, preferredLane: number) => {
    if (relativeBeat * beat >= TEST_DURATION) return;
    const time = startTime + relativeBeat * beat;
    // Keep even high-BPM practice comfortable: dense subdivisions change fingers.
    const lane = Array.from({ length: 6 }, (_, i) => (preferredLane + i) % 6)
      .find(candidate => time - lastTime[candidate] >= 0.3 - 1e-8);
    if (lane === undefined) return;
    lastTime[lane] = time;
    notes.push({ id: 0, time, lane, type: 'tap' });
  };
  for (let b = 0; b * beat < TEST_DURATION; b++) {
    const lane = lanes[b % lanes.length];
    add(b, lane);
    if (b % 8 === 4) add(b, (lane + 3) % 6);
    if (b % 4 === 1) add(b + 0.5, (lane + 2) % 6);
    if (b % 16 === 11) add(b + 0.75, (lane + 4) % 6);
  }
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  notes.forEach((note, i) => { note.id = i + 1; });
  return { videoId: VIDEO_ID, title: 'SUPER MOMMY GIRLS', bpm, startTime, notes };
}
