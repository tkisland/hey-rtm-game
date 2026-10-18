export const PLAYER_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;
export function stateName(state: number): string {
  return Object.entries(PLAYER_STATE).find(([, value]) => value === state)?.[0] ?? 'LOADING';
}
export const CLOCK_LIMITS = {
  prediction: 0.5,       // Never run indefinitely from wall time if API updates stop.
  maxPrediction: 1,     // Extend only after observing sparse updates progressing at the requested rate.
  correctionRate: 0.2,   // Correct small timing errors smoothly at 0.8x–1.2x speed.
  maxLead: 0.05,        // At a fresh timestamp, do not keep outrunning a slow video clock.
  progressWindow: 0.8, // Observe multiple updates before adapting to a genuinely slower clock.
  seek: 0.4,
  backwards: 0.06,
  suspendedFrame: 0.75,
} as const;
export interface ClockSample {
  time: number;
  rawTime: number;
  playing: boolean;
  seek: boolean;
  resync: boolean;
  backwards: boolean;
  stale: boolean;
  predictionRate: number;
}

/** Short bounded interpolation, repeatedly anchored to fresh YouTube timestamps. */
export class VideoClock {
  private previous: { rawTime: number; wall: number; state: number; rate: number } | null = null;
  private anchor = { time: 0, wall: 0 };
  private time = 0;
  private stale = false;
  private progress: { time: number; wall: number } | null = null;
  private predictionRate = 1;

  private updateIntervals: number[] = [];
  private horizon: number = CLOCK_LIMITS.prediction;

  reset(): void { this.previous = null; this.stale = false; this.progress = null; this.updateIntervals = []; this.horizon = CLOCK_LIMITS.prediction; }

  sample(rawTime: number, state: number, wallMs: number, playbackRate = 1): ClockSample {
    const previous = this.previous;
    const valid = Number.isFinite(rawTime);
    const observedRaw = valid ? Math.max(0, rawTime) : previous?.rawTime ?? 0;
    // Some iframe updates briefly replay an older timestamp. While playing,
    // ignore a small reversal rather than resetting an entire score session.
    const backwardJitter = previous && previous.state === PLAYER_STATE.PLAYING && state === PLAYER_STATE.PLAYING &&
      observedRaw < previous.rawTime && previous.rawTime - observedRaw <= CLOCK_LIMITS.seek;
    const raw = backwardJitter ? previous.rawTime : observedRaw;
    const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
    const rateChanged = previous !== null && rate !== previous.rate;
    const playingState = valid && state === PLAYER_STATE.PLAYING;
    const fresh = !previous || Math.abs(raw - previous.rawTime) > 1e-6;
    const stateChanged = !previous || state !== previous.state;
    const elapsed = previous ? Math.max(0, (wallMs - previous.wall) / 1000) : 0;
    let seek = false;
    let backwards = false;
    let resync = false;
    if (valid && previous) {
      const delta = raw - previous.rawTime;
      const wasPlaying = previous.state === PLAYER_STATE.PLAYING;
      // Compare sparse API updates with elapsed time since the LAST FRESH update,
      // not the last animation frame. A normal 250ms update must not look like a seek.
      const expected = wasPlaying ? this.anchor.time + Math.max(0, (wallMs - this.anchor.wall) / 1000) * this.predictionRate : previous.rawTime;
      const tolerance = wasPlaying || stateChanged ? CLOCK_LIMITS.seek : CLOCK_LIMITS.backwards;
      const reportedExpected = wasPlaying ? this.anchor.time + Math.max(0,(wallMs-this.anchor.wall)/1000)*previous.rate : previous.rawTime;
      const discontinuity = fresh && Math.min(Math.abs(raw-expected),Math.abs(raw-reportedExpected)) > tolerance;
      const suspended = wasPlaying && elapsed > CLOCK_LIMITS.suspendedFrame && Math.abs(delta) > 0.16;
      const recovered = wasPlaying && playingState && this.stale && fresh;
      seek = delta < -(wasPlaying || stateChanged ? CLOCK_LIMITS.seek : CLOCK_LIMITS.backwards) || discontinuity;
      resync = !seek && (suspended || recovered);
      backwards = seek && delta < 0;
    }

    if (stateChanged || rateChanged || seek) {
      this.updateIntervals = []; this.horizon = CLOCK_LIMITS.prediction;
    } else if (playingState && fresh) {
      const gap = (wallMs-this.anchor.wall)/1000;
      const observedRate = gap > 0 ? (raw-this.anchor.time)/gap : 0;
      if (gap > 0 && gap <= CLOCK_LIMITS.maxPrediction && Math.abs(observedRate-rate) <= rate*CLOCK_LIMITS.correctionRate) {
        this.updateIntervals.push(gap); if(this.updateIntervals.length>4)this.updateIntervals.shift();
        this.horizon = Math.max(CLOCK_LIMITS.prediction,Math.min(CLOCK_LIMITS.maxPrediction,Math.max(...this.updateIntervals)*1.25));
      }
    }
    if (!playingState || stateChanged || rateChanged || seek || resync) {
      // Pause/buffering and resuming/seek use the authoritative timestamp immediately.
      if (valid) { this.anchor = { time: raw, wall: wallMs }; this.time = raw; }
      this.stale = !valid;
      this.predictionRate = rate;
      this.progress = playingState ? {time:raw,wall:wallMs} : null;
    } else {
      if (fresh) {
        this.progress ??= {time:raw,wall:wallMs};
        const window = (wallMs - this.progress.wall) / 1000;
        if (window >= CLOCK_LIMITS.progressWindow) {
          const observed = Math.max(0,(raw - this.progress.time) / window);
          // Small arrival jitter remains smoothed at the requested speed. A clock slower
          // than the normal correction range must also slow prediction between API updates.
          this.predictionRate = observed < rate * (1 - CLOCK_LIMITS.correctionRate) ? observed : rate;
          this.progress = {time:raw,wall:wallMs};
        }
      }
      if (fresh) this.anchor = { time: raw, wall: wallMs };
      const age = Math.max(0, (wallMs - this.anchor.wall) / 1000);
      const target = this.anchor.time + Math.min(age, this.horizon) * this.predictionRate;
      const advance = elapsed * this.predictionRate;
      const predicted = this.time + advance;
      const correction = Math.max(-advance * CLOCK_LIMITS.correctionRate,
        Math.min(advance * CLOCK_LIMITS.correctionRate, target - predicted));
      // The normal 0.8x minimum correction speed can outrun a video clock advancing
      // below that speed even though it continues reporting PLAYING/fresh timestamps.
      // Bound that extra lead relative to the extrapolated target, not just the last raw
      // timestamp. Late arrivals may briefly hold the output; jitter never reverses it.
      const bounded = Math.min(predicted + correction, target + CLOCK_LIMITS.maxLead * this.predictionRate);
      this.time = Math.max(this.time,
        Math.min(this.anchor.time + this.horizon * this.predictionRate, bounded));
      this.stale = age > this.horizon;
    }
    this.previous = { rawTime: raw, wall: wallMs, state, rate };
    return { time: this.time, rawTime: observedRaw, playing: playingState && !this.stale, seek, resync, backwards, stale: this.stale, predictionRate:this.predictionRate };
  }
}
