export interface SyncObservation {
  atMs: number;
  apiTime: number;
  clockTime: number;
  judgementTime: number;
  playerState: number;
  reportedRate: number;
  predictionRate: number;
  playing: boolean;
  stale: boolean;
  seek: boolean;
  inputOffsetMs: number;
  chartOffsetMs: number;
  noteOffsetMs?: number;
  inputErrorMs: number | null;
  frameGapMs: number;
  fps: number;
  longTaskCount: number;
  longestTaskMs: number;
  visibility: string;
}
export interface SyncTraceRow extends SyncObservation {
  elapsedMs: number;
  clockLeadMs: number;
  noteLeadMs: number;
  apiUpdateAgeMs: number;
  observedRate: number | null;
  maxFrameGapMs: number;
}
export const SYNC_TRACE_LIMIT = 480;
/** Bounded local samples. API progression is an observation, not decoded audio/video timing. */
export class SyncTrace {
  private rows: SyncTraceRow[] = [];
  private previous: SyncObservation | null = null;
  private startedAt = 0;
  private lastUpdateAt = 0;
  private lastStoredAt = -Infinity;
  private maxFrameGap = 0;
  private rateAnchor: { atMs: number; apiTime: number } | null = null;
  private observedRate: number | null = null;

  record(sample: SyncObservation): SyncTraceRow | null {
    const previous = this.previous;
    if (!previous) { this.startedAt = sample.atMs; this.lastUpdateAt = sample.atMs; }
    const valid = Number.isFinite(sample.apiTime);
    if (valid && (!previous || sample.apiTime !== previous.apiTime)) this.lastUpdateAt = sample.atMs;
    const changed = !previous || sample.playerState !== previous.playerState || sample.stale !== previous.stale;
    const backwards = previous && sample.apiTime < previous.apiTime - .06;
    if (!valid || !sample.playing || sample.stale || sample.seek || changed || backwards) {
      this.rateAnchor = null; this.observedRate = null;
    }
    if (valid && sample.playing && !sample.stale) {
      this.rateAnchor ??= {atMs:sample.atMs,apiTime:sample.apiTime};
      const elapsed = sample.atMs - this.rateAnchor.atMs;
      if (elapsed >= 2000) {
        this.observedRate = (sample.apiTime - this.rateAnchor.apiTime) / (elapsed / 1000);
        this.rateAnchor = {atMs:sample.atMs,apiTime:sample.apiTime};
      }
    }
    this.maxFrameGap = Math.max(this.maxFrameGap, sample.frameGapMs);
    this.previous = sample;
    if (!changed && !sample.seek && sample.atMs - this.lastStoredAt < 250) return null;
    const row: SyncTraceRow = { ...sample, elapsedMs:sample.atMs - this.startedAt,
      clockLeadMs:(sample.clockTime - sample.apiTime) * 1000,
      noteLeadMs:(sample.judgementTime - sample.apiTime) * 1000,
      apiUpdateAgeMs:sample.atMs - this.lastUpdateAt, observedRate:this.observedRate, maxFrameGapMs:this.maxFrameGap };
    this.lastStoredAt = sample.atMs; this.maxFrameGap = 0;
    this.rows.push(row); if (this.rows.length > SYNC_TRACE_LIMIT) this.rows.shift();
    return row;
  }
  snapshot(): SyncTraceRow[] { return this.rows.map(row => ({...row})); }
}
