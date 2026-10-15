import smg001 from './charts/smg001.json';
import { copyChart, parseChart } from './editor-model';
import { DEFAULT_SONG } from './songs';
import type { Song } from './songs';

const charts = new Map([['smg001', parseChart(JSON.stringify(smg001), true, DEFAULT_SONG)]]);
/** Fresh snapshots keep bundled charts independent from editor history and local storage. */
export function bundledChart(song: Song) {
  const chart = song.chartId ? charts.get(song.chartId) : undefined;
  return chart && chart.videoId === song.videoId ? copyChart(chart) : null;
}
