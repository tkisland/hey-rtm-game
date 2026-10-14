export interface Settings { travel: number; offset: number; bpm: number; startTime: number; debug: boolean; sound: boolean; soundVolume: number; noteSize: number; inputOffset: number; soundDelay: number }
export const DEFAULT_SETTINGS: Settings = { travel: 2, offset: 0, bpm: 140, startTime: 12, debug: false, sound: true, soundVolume: 70, noteSize: 100, inputOffset: 0, soundDelay: 0 };
export const INPUT_OFFSET_LIMIT_MS = 300;
const STORAGE_KEY = 'hey-rhythm-settings-v1';
function numeric(value: unknown, fallback: number, min: number, max: number, step: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Number((Math.round(Math.min(max, Math.max(min, value)) / step) * step).toFixed(3));
}
export function normalizeSettings(value: Partial<Settings>): Settings {
  return {
    travel: numeric(value.travel, 2, 1, 4, 0.25),
    offset: numeric(value.offset, 0, -300, 300, 10),
    bpm: numeric(value.bpm, 140, 80, 200, 1),
    startTime: numeric(value.startTime, 12, 0, 3600, 0.1),
    debug: value.debug === true,
    sound: value.sound !== false,
    soundVolume: numeric(value.soundVolume, 70, 0, 100, 5),
    noteSize: numeric(value.noteSize, 100, 50, 150, 10),
    inputOffset: numeric(value.inputOffset, 0, -INPUT_OFFSET_LIMIT_MS, INPUT_OFFSET_LIMIT_MS, 5),
    soundDelay: numeric(value.soundDelay, 0, 0, 300, 5),
  };
}
export function loadSettings(): Settings {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return normalizeSettings(parsed && typeof parsed === 'object' ? parsed : {});
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(settings: Settings): boolean {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); return true; }
  catch { return false; }
}
