import { VIDEO_ID } from './chart';
import type { Chart, ChartNote } from './chart';

export const TUTORIAL_BPM = 90;
export const TUTORIAL_BEAT = 60 / TUTORIAL_BPM;
export const TUTORIAL_TRAVEL = 2.5;

/** Four count-in beats, followed by a few real notes for each gesture. */
export function tutorialChart(step: number): Chart {
  const notes: ChartNote[] = [];
  const tap = (beat: number, lane: number) => notes.push({id:notes.length + 1, type:'tap', time:beat * TUTORIAL_BEAT, lane});
  if (step === 0) [0,2,5].forEach((lane, index) => tap(4 + index * 3, lane));
  else if (step === 1) [[0,5],[1,4],[2,3]].forEach((lanes, index) => lanes.forEach(lane => tap(4 + index * 3, lane)));
  else for (const [beat,lane] of [[4,2],[9,0]]) notes.push({id:notes.length + 1, type:'hold', time:beat * TUTORIAL_BEAT, endTime:(beat + 2) * TUTORIAL_BEAT, lane});
  return {videoId:VIDEO_ID, title:'チュートリアル', bpm:TUTORIAL_BPM, beatOrigin:0, startTime:4 * TUTORIAL_BEAT, notes};
}
