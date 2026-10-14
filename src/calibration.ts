// All times are seconds on the reference AudioContext's clock, before any saved correction.
export const CALIBRATION = { warmup: 4, beats: 10, interval: 0.9, window: 0.4 } as const;
export type CalibrationResult =
  | { ok: true; offset: number; samples: number; spread: number }
  | { ok: false; reason: 'insufficient' | 'unstable' | 'range' };
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export class CalibrationMeasurement {
  readonly taps = new Map<number, number>();
  constructor(readonly firstBeat: number) {}
  get firstMeasured(): number { return this.firstBeat + CALIBRATION.warmup * CALIBRATION.interval; }
  get end(): number { return this.firstMeasured + (CALIBRATION.beats - 1) * CALIBRATION.interval + CALIBRATION.window; }
  tap(time: number): boolean {
    if (!Number.isFinite(time)) return false;
    const beat = Math.round((time - this.firstMeasured) / CALIBRATION.interval);
    const error = time - (this.firstMeasured + beat * CALIBRATION.interval);
    if (beat < 0 || beat >= CALIBRATION.beats || Math.abs(error) > CALIBRATION.window + 1e-9 || this.taps.has(beat)) return false;
    this.taps.set(beat, error * 1000);
    return true;
  }
  result(): CalibrationResult {
    const values = [...this.taps.values()];
    if (values.length < 8) return { ok: false, reason: 'insufficient' };
    const center = median(values);
    const deviations = values.map(value => Math.abs(value - center));
    // Ignore isolated slips, but never turn a consistently irregular sequence into a valid result.
    const cutoff = Math.max(30, 3 * median(deviations));
    const accepted = values.filter(value => Math.abs(value - center) <= cutoff);
    if (accepted.length < 8) return { ok: false, reason: 'unstable' };
    const spread = Math.max(...accepted) - Math.min(...accepted);
    if (spread > 80 + 1e-6) return { ok: false, reason: 'unstable' };
    const measured = median(accepted);
    if (Math.abs(measured) > 300 + 1e-6) return { ok: false, reason: 'range' };
    return { ok: true, offset: Math.round(measured / 5) * 5 || 0, samples: accepted.length, spread: Math.round(spread) };
  }
}
