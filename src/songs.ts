export interface Song {
  id: string;
  title: string;
  artist: string;
  videoId: string;
  bpm: number;
  startTime: number;
  chartId?: string;
}
export const DEFAULT_SONG: Song = {
  id: 'super-mommy-girls', title: 'SUPER MOMMY GIRLS', artist: 'Hey!Mommy!',
  videoId: 'pJDfWpZ7CI4', bpm: 140, startTime: 12, chartId: 'smg005',
};
export const BISCUIT_CASE: Song = {
  id: 'biscuit-case', title: 'ビスケットケース', artist: 'Hey!Mommy!',
  // Uploaded MP3: opening tempo and first clear beat. Video alignment remains provisional.
  videoId: 'JUsGoi24rug', bpm: 200, startTime: 3,
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
