import { VIDEO_ID } from './chart';
import type { Chart, ChartNote } from './chart';
import { NOTE_TRAVEL_SECONDS } from './settings';

export const TUTORIAL_BPM = 90;
export const TUTORIAL_BEAT = 60 / TUTORIAL_BPM;
export const TUTORIAL_TRAVEL = NOTE_TRAVEL_SECONDS;

/** Four count-in beats, followed by a few real notes for each gesture. */
export function tutorialChart(step: number): Chart {
  const notes: ChartNote[] = [];
  const tap = (beat: number, lane: number) => notes.push({id:notes.length + 1, type:'tap', time:beat * TUTORIAL_BEAT, lane});
  if (step === 0) [0,2,5].forEach((lane, index) => tap(4 + index * 3, lane));
  else if (step === 1) [[0,5],[1,4],[2,3]].forEach((lanes, index) => lanes.forEach(lane => tap(4 + index * 3, lane)));
  else if (step === 2) for (const [beat,lane] of [[4,2],[9,0]]) notes.push({id:notes.length + 1, type:'hold', time:beat * TUTORIAL_BEAT, endTime:(beat + 2) * TUTORIAL_BEAT, lane});
  else if (step === 3) for (let lane = 0; lane < 6; lane++) notes.push({id:lane + 1, type:'tap', gimmick:'box', boxId:1, time:4 * TUTORIAL_BEAT, lane});
  else if (step === 4) [4,7,10].forEach(beat => notes.push({id:notes.length + 1, type:'tap', gimmick:'dd', time:beat * TUTORIAL_BEAT, lane:2}));
  else notes.push({id:1, type:'hold', gimmick:'slide', time:4 * TUTORIAL_BEAT, endTime:10 * TUTORIAL_BEAT, lane:1, path:[{time:6 * TUTORIAL_BEAT,lane:2},{time:8 * TUTORIAL_BEAT,lane:3}]});
  return {videoId:VIDEO_ID, title:'チュートリアル', bpm:TUTORIAL_BPM, beatOrigin:0, startTime:4 * TUTORIAL_BEAT, notes};
}
