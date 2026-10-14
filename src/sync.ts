export const PLAYER_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;
export function stateName(state: number): string {
  return Object.entries(PLAYER_STATE).find(([, value]) => value === state)?.[0] ?? 'LOADING';
}
export const CLOCK_LIMITS = {
  prediction: 0.5,       // Never run indefinitely from wall time if API updates stop.
  correctionRate: 0.2,   // Correct small timing errors smoothly at 0.8x–1.2x speed.
  seek: 0.4,
  backwards: 0.06,
  suspendedFrame: 0.75,
} as const;
export interface ClockSample {
  time: number;
  rawTime: number;
  playing: boolean;
  seek: boolean;
  backwards: boolean;
  stale: boolean;
}

/** Short bounded interpolation, repeatedly anchored to fresh YouTube timestamps. */
export class VideoClock {
  private previous: { rawTime: number; wall: number; state: number; rate: number } | null = null;
  private anchor = { time: 0, wall: 0 };
  private time = 0;
  private stale = false;

  reset(): void { this.previous = null; this.stale = false; }

  sample(rawTime: number, state: number, wallMs: number, playbackRate = 1): ClockSample {
    const previous = this.previous;
    const valid = Number.isFinite(rawTime);
    const raw = valid ? Math.max(0, rawTime) : previous?.rawTime ?? 0;
    const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
    const rateChanged = previous !== null && rate !== previous.rate;
    const playingState = valid && state === PLAYER_STATE.PLAYING;
    const fresh = !previous || Math.abs(raw - previous.rawTime) > 1e-6;
    const stateChanged = !previous || state !== previous.state;
    const elapsed = previous ? Math.max(0, (wallMs - previous.wall) / 1000) : 0;
    let seek = false;
    let backwards = false;
    if (valid && previous) {
      const delta = raw - previous.rawTime;
      const wasPlaying = previous.state === PLAYER_STATE.PLAYING;
      // Compare sparse API updates with elapsed time since the LAST FRESH update,
      // not the last animation frame. A normal 250ms update must not look like a seek.
      const expected = wasPlaying ? this.anchor.time + Math.max(0, (wallMs - this.anchor.wall) / 1000) * previous.rate : previous.rawTime;
      const tolerance = wasPlaying || stateChanged ? CLOCK_LIMITS.seek : CLOCK_LIMITS.backwards;
      const discontinuity = fresh && Math.abs(raw - expected) > tolerance;
      const suspended = wasPlaying && elapsed > CLOCK_LIMITS.suspendedFrame && Math.abs(delta) > 0.16;
      const recovered = wasPlaying && playingState && this.stale && fresh;
      seek = delta < -CLOCK_LIMITS.backwards || discontinuity || suspended || recovered;
      backwards = seek && delta < 0;
    }

    if (!playingState || stateChanged || rateChanged || seek) {
      // Pause/buffering and resuming/seek use the authoritative timestamp immediately.
      if (valid) { this.anchor = { time: raw, wall: wallMs }; this.time = raw; }
      this.stale = !valid;
    } else {
      if (fresh) this.anchor = { time: raw, wall: wallMs };
      const age = Math.max(0, (wallMs - this.anchor.wall) / 1000);
      const target = this.anchor.time + Math.min(age, CLOCK_LIMITS.prediction) * rate;
      const advance = elapsed * rate;
      const predicted = this.time + advance;
      const correction = Math.max(-advance * CLOCK_LIMITS.correctionRate,
        Math.min(advance * CLOCK_LIMITS.correctionRate, target - predicted));
      // Small delivery jitter never moves the notes backwards. Hard seeks already resync above.
      this.time = Math.min(this.anchor.time + CLOCK_LIMITS.prediction * rate,
        Math.max(this.time, predicted + correction));
      this.stale = age > CLOCK_LIMITS.prediction;
    }
    this.previous = { rawTime: raw, wall: wallMs, state, rate };
    return { time: this.time, rawTime: raw, playing: playingState && !this.stale, seek, backwards, stale: this.stale };
  }
}
