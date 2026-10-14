export const PLAYER_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;
export function stateName(state: number): string {
  return Object.entries(PLAYER_STATE).find(([, value]) => value === state)?.[0] ?? 'LOADING';
}
export interface ClockSample { time: number; playing: boolean; seek: boolean; backwards: boolean }

/** Read authoritative time on every frame and input. Never advance from wall time alone. */
export class VideoClock {
  private previous: { time: number; wall: number; state: number } | null = null;
  reset(): void { this.previous = null; }
  sample(time: number, state: number, wallMs: number): ClockSample {
    const previous = this.previous;
    const validTime = Number.isFinite(time) ? Math.max(0, time) : previous?.time ?? 0;
    let seek = false;
    let backwards = false;
    if (previous) {
      const delta = validTime - previous.time;
      // A suspended tab is treated as a discontinuity, so returning never adds a burst of misses.
      const elapsed = Math.min(Math.max(0, (wallMs - previous.wall) / 1000), 0.25);
      const wasPlaying = previous.state === PLAYER_STATE.PLAYING;
      const expected = wasPlaying ? elapsed : 0;
      const tolerance = wasPlaying ? 0.4 : 0.06;
      seek = delta < -0.06 || Math.abs(delta - expected) > tolerance;
      backwards = seek && delta < 0;
    }
    this.previous = { time: validTime, wall: wallMs, state };
    return { time: validTime, playing: state === PLAYER_STATE.PLAYING, seek, backwards };
  }
}
