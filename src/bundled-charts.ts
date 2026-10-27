import bsc002 from './charts/bsc002.json';
import smg005 from './charts/smg005.json';
import { copyChart, parseChart } from './chart-data';
import { BISCUIT_CASE, DEFAULT_SONG } from './songs';
import type { Song } from './songs';
import { DEFAULT_DIFFICULTY } from './difficulties';
import type { Difficulty } from './difficulties';

const charts = new Map([
  ['smg005', parseChart(JSON.stringify(smg005), true, DEFAULT_SONG)],
  ['bsc002', parseChart(JSON.stringify(bsc002), true, BISCUIT_CASE)],
]);
/** Fresh snapshots keep bundled charts independent from editor history and local storage. */
export function bundledChart(song: Song, difficulty: Difficulty = DEFAULT_DIFFICULTY) {
  const id = song.charts?.[difficulty] ?? (difficulty === DEFAULT_DIFFICULTY ? song.chartId : undefined);
  const chart = id ? charts.get(id) : undefined;
  return chart && chart.videoId === song.videoId ? copyChart(chart) : null;
}
