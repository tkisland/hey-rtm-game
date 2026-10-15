import { WINDOWS } from './engine';
import { INPUT_OFFSET_LIMIT_MS } from './settings';

export type HitZone = 'PERFECT' | 'GREAT' | 'GOOD';
export interface FieldGeometry {
  anchor: number;
  speed: number;
  center: number;
  bands: { kind: HitZone; top: number; bottom: number }[];
}
/** Convert the engine's timing windows to distances on the uncorrected visual clock. */
export function fieldGeometry(height: number, travel: number, inputOffsetMs = 0): FieldGeometry {
  // Reserve space for the latest valid input, including the maximum supported compensation.
  // The anchor never depends on the current compensation, so changing it only moves the target.
  const latest = INPUT_OFFSET_LIMIT_MS / 1000 + WINDOWS.GOOD;
  const anchor = Math.min(Math.max(0, height - 25), Math.max(0, height - 8) / (1 + latest / travel));
  const speed = anchor / travel;
  const center = anchor + inputOffsetMs / 1000 * speed;
  const bands = (['GOOD', 'GREAT', 'PERFECT'] as const).map(kind => ({
    kind, top: center - WINDOWS[kind] * speed, bottom: center + WINDOWS[kind] * speed,
  }));
  return { anchor, speed, center, bands };
}
