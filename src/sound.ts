/** Short locally synthesized tap sounds. YouTube audio and game timing are untouched. */
export class TapSound {
  private context: AudioContext | null = null;
  private disposed = false;
  enabled = true;
  constructor(private onUnavailable: () => void) {}

  play(lane: number): void {
    if (!this.enabled || this.disposed) return;
    try {
      // Construct/resume inside the input gesture for Safari's audio activation rules.
      const AudioContextClass = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) { this.onUnavailable(); return; }
      this.context ??= new AudioContextClass({ latencyHint: 'interactive' });
      const context = this.context;
      if (context.state === 'running') this.tone(context, lane);
      else void context.resume().then(() => {
        if (this.enabled && !this.disposed && context.state === 'running') this.tone(context, lane);
      }).catch(() => this.onUnavailable());
    } catch { this.onUnavailable(); }
  }

  private tone(context: AudioContext, lane: number): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime([523.25, 587.33, 659.25, 783.99, 880, 1046.5][lane] ?? 659.25, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(now); oscillator.stop(now + 0.065);
  }

  destroy(): void {
    this.disposed = true;
    if (this.context) void this.context.close().catch(() => {});
  }
}
