import { DEFAULT_SONG, songStorageKey } from './songs';
import type { Song } from './songs';

/** noteSize is retained only for the administrator's editing timeline. */
export interface Settings { travel: number; offset: number; bpm: number; startTime: number; debug: boolean; sound: boolean; soundVolume: number; noteSize: number; noteOffset: number; inputOffset: number; soundDelay: number }
export const NOTE_TRAVEL_SECONDS = 2.5;
export const DEFAULT_SETTINGS: Settings = { travel: NOTE_TRAVEL_SECONDS, offset: 0, bpm: 140, startTime: 12, debug: false, sound: true, soundVolume: 70, noteSize: 100, noteOffset: 0, inputOffset: 0, soundDelay: 0 };
export const INPUT_OFFSET_LIMIT_MS = 300;
const STORAGE_KEY = 'hey-rhythm-settings-v1';
function numeric(value: unknown, fallback: number, min: number, max: number, step: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Number((Math.round(Math.min(max, Math.max(min, value)) / step) * step).toFixed(3));
}
export function normalizeSettings(value: Partial<Settings>): Settings {
  return {
    travel: numeric(value.travel, NOTE_TRAVEL_SECONDS, 1, 4, 0.25),
    offset: numeric(value.offset, 0, -300, 300, 10),
    bpm: numeric(value.bpm, 140, 80, 200, 1),
    startTime: numeric(value.startTime, 12, 0, 3600, 0.1),
    debug: value.debug === true,
    sound: value.sound !== false,
    soundVolume: numeric(value.soundVolume, 70, 0, 100, 5),
    noteSize: numeric(value.noteSize, 100, 50, 150, 10),
    // Migrate the old combined correction without changing note arrival or judgement.
    noteOffset: numeric(value.noteOffset, numeric(value.inputOffset, 0, -300, 300, 5), -300, 300, 5),
    inputOffset: value.noteOffset === undefined ? 0 : numeric(value.inputOffset, 0, -INPUT_OFFSET_LIMIT_MS, INPUT_OFFSET_LIMIT_MS, 5),
    soundDelay: numeric(value.soundDelay, 0, 0, 300, 5),
  };
}
/** Public play exposes travel time, calibration and volume; retired controls cannot add hidden shifts. */
export function normalizePlayerSettings(value: Partial<Settings>): Settings {
  const settings = normalizeSettings(value);
  return { ...settings, offset: 0, soundDelay: 0, debug: false, sound: true,
    soundVolume: settings.sound ? settings.soundVolume : 0 };
}
function readSettings(key: string): Partial<Settings> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
export function loadSettings(song: Song = DEFAULT_SONG): Settings {
  const shared = normalizeSettings(readSettings(STORAGE_KEY));
  if (song.id === DEFAULT_SONG.id) return shared;
  const scoped = readSettings(songStorageKey('hey-rhythm-song-settings-v1', song));
  return normalizeSettings({ ...shared, bpm: scoped.bpm ?? song.bpm, startTime: scoped.startTime ?? song.startTime, offset: scoped.offset ?? 0 });
}
export function saveSettings(settings: Settings, song: Song = DEFAULT_SONG): boolean {
  settings = normalizeSettings(settings);
  try {
    if (song.id === DEFAULT_SONG.id) localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    else {
      const previous = loadSettings();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, bpm: previous.bpm, startTime: previous.startTime, offset: previous.offset }));
      localStorage.setItem(songStorageKey('hey-rhythm-song-settings-v1', song), JSON.stringify({ bpm: settings.bpm, startTime: settings.startTime, offset: settings.offset }));
    }
    return true;
  }
  catch { return false; }
}
