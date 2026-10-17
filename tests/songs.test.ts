import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SONG, findSong, SONGS, songStorageKey, songUrl } from '../src/songs';
import { generateChart } from '../src/chart';
import { CUSTOM_CHART_KEY, EDITOR_KEY, emptyChart, loadChart, parseChart, storeChart } from '../src/editor-model';
import { loadSettings, saveSettings } from '../src/settings';

const second = { id: 'second-song', title: 'Second test song', artist: 'Test artist', videoId: 'abcdefghijk', bpm: 120, startTime: 8 };
function storage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
  return data;
}
afterEach(() => vi.unstubAllGlobals());
it('fixes every song to a 2.5 second lead-in and migrates legacy fall times without losing correction', () => {
  const data = storage();
  expect(loadSettings().travel).toBe(2.5);
  for (const travel of [1, 2, 3.25, 4]) {
    data.set('hey-rhythm-settings-v1', JSON.stringify({ travel, inputOffset: 80 }));
    expect(loadSettings()).toMatchObject({ travel:2.5, inputOffset:80 });
    expect(loadSettings(second)).toMatchObject({ travel:2.5, inputOffset:80 });
    saveSettings({ ...loadSettings(), travel });
    expect(JSON.parse(data.get('hey-rhythm-settings-v1')!).travel).toBe(2.5);
    expect(loadSettings().travel).toBe(2.5);
    expect(loadSettings(second).travel).toBe(2.5);
  }
});
it('registers only real available content and resolves stable song URLs', () => {
  expect(SONGS).toEqual([DEFAULT_SONG]); expect(findSong(null)).toBe(DEFAULT_SONG);
  expect(findSong(DEFAULT_SONG.id)).toBe(DEFAULT_SONG); expect(findSong('unknown')).toBeUndefined();
  expect(songUrl(second, 'game', true)).toBe('./game.html?song=second-song&chart=custom');
  expect(songUrl(second, 'editor')).toBe('./editor.html?song=second-song');
});
it('creates practice and empty editor charts from the selected song metadata', () => {
  expect(generateChart(second.bpm, second.startTime, second)).toMatchObject({ videoId: second.videoId, title: second.title, bpm: 120, startTime: 8 });
  expect(emptyChart(second)).toMatchObject({ videoId: second.videoId, title: second.title, bpm: 120, beatOrigin: 8, notes: [] });
  const document = { ...emptyChart(second), notes: [{ id: 1, lane: 0, time: 10, type: 'tap' }] };
  expect(parseChart(JSON.stringify(document), true, second).videoId).toBe(second.videoId);
  expect(() => parseChart(JSON.stringify(document), true, DEFAULT_SONG)).toThrow('動画ID');
  expect(() => parseChart(JSON.stringify(generateChart()), true, second)).toThrow('動画ID');
});
it('retains the original keys and isolates drafts and play charts for another song', () => {
  const data = storage(), original = generateChart(), other = generateChart(120, 8, second);
  expect(songStorageKey(EDITOR_KEY, DEFAULT_SONG)).toBe(EDITOR_KEY);
  expect(songStorageKey(CUSTOM_CHART_KEY, DEFAULT_SONG)).toBe(CUSTOM_CHART_KEY);
  storeChart(EDITOR_KEY, original); storeChart(songStorageKey(EDITOR_KEY, second), other);
  storeChart(CUSTOM_CHART_KEY, original); storeChart(songStorageKey(CUSTOM_CHART_KEY, second), other);
  expect(data.size).toBe(4);
  expect(loadChart(EDITOR_KEY)).toMatchObject(original);
  expect(loadChart(songStorageKey(EDITOR_KEY, second), true, second)?.videoId).toBe(second.videoId);
  expect(loadChart(EDITOR_KEY, true, second)).toBeNull();
});
it('separates song timing/BPM defaults while sharing device and audio preferences', () => {
  storage(); const original = { ...loadSettings(), bpm: 150, startTime: 14, offset: 200, inputOffset: 50, soundVolume: 40 };
  saveSettings(original);
  expect(loadSettings(second)).toMatchObject({ bpm: 120, startTime: 8, offset: 0, inputOffset: 50, soundVolume: 40 });
  saveSettings({ ...loadSettings(second), bpm: 160, startTime: 9, offset: -100, inputOffset: 75, soundVolume: 60 }, second);
  expect(loadSettings()).toMatchObject({ bpm: 150, startTime: 14, offset: 200, inputOffset: 75, soundVolume: 60 });
  expect(loadSettings(second)).toMatchObject({ bpm: 160, startTime: 9, offset: -100, inputOffset: 75 });
});
it('handles broken per-song settings without losing shared input/audio preferences', () => {
  const data = storage(); saveSettings({ ...loadSettings(), inputOffset: 100, soundVolume: 35 });
  data.set(songStorageKey('hey-rhythm-song-settings-v1', second), '{');
  expect(loadSettings(second)).toMatchObject({ bpm: 120, startTime: 8, offset: 0, inputOffset: 100, soundVolume: 35 });
});
