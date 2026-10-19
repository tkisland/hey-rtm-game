export interface Song {
  id: string;
  title: string;
  artist: string;
  videoId: string;
  bpm: number;
  startTime: number;
  chartId?: string;
  /** Editor defaults only; saved/imported charts keep their own tempo maps. */
  tempoChanges?: readonly { time: number; bpm: number }[];
  tempoEstimated?: boolean;
}
export const DEFAULT_SONG: Song = {
  id: 'super-mommy-girls', title: 'SUPER MOMMY GIRLS', artist: 'Hey!Mommy!',
  videoId: 'pJDfWpZ7CI4', bpm: 140, startTime: 12, chartId: 'smg005',
};
export const BISCUIT_CASE: Song = {
  id: 'biscuit-case', title: 'ビスケットケース', artist: 'Hey!Mommy!',
  // MIDI tick zero is placed at video 2.95s; editor defaults use the authored tempo map.
  videoId: 'JUsGoi24rug', bpm: 200, startTime: 2.95, chartId: 'bsc001',
  tempoChanges: [
    {time:24.549375,bpm:205.000649169},
    {time:100.647304754,bpm:200},
    {time:112.647304754,bpm:205.000649169},
    {time:188.744624754,bpm:203.000345101},
    {time:213.572168754,bpm:205.000649169},
    {time:235.83734215,bpm:200},
  ],
};
/** Register additional songs here; routing and storage use the stable ID. */
export const SONGS: readonly Song[] = [DEFAULT_SONG, BISCUIT_CASE];
export function findSong(id: string | null): Song | undefined {
  return id === null ? DEFAULT_SONG : SONGS.find(song => song.id === id);
}
export function songUrl(song: Song, page: 'game' | 'editor', chart: boolean | 'test' | 'bundled' = false): string {
  const query = new URLSearchParams({ song: song.id });
  if (chart && page === 'game') query.set('chart', chart === true ? 'custom' : chart);
  return `./${page}.html?${query}`;
}
export function songStorageKey(base: string, song: Song): string {
  // Keep existing data for the original song without migration writes.
  return song.id === DEFAULT_SONG.id ? base : `${base}:${song.id}`;
}
export function songVideoUrl(song: Song): string { return `https://www.youtube.com/watch?v=${song.videoId}`; }
