import smg004 from './charts/smg004.json';
import { copyChart, parseChart } from './chart-data';
import { DEFAULT_SONG } from './songs';
import type { Song } from './songs';

const charts = new Map([['smg004', parseChart(JSON.stringify(smg004), true, DEFAULT_SONG)]]);
/** Fresh snapshots keep bundled charts independent from editor history and local storage. */
export function bundledChart(song: Song) {
  const chart = song.chartId ? charts.get(song.chartId) : undefined;
  return chart && chart.videoId === song.videoId ? copyChart(chart) : null;
}
