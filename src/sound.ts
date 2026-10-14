export const TAP_DURATION = 0.075;
const FREQUENCIES = [900, 960, 1020, 1080, 1140, 1200];

/** A deterministic, percussive click with a sharp noise attack and a short tonal body. */
export function createTapSamples(sampleRate: number, lane: number) {
  const samples = new Float32Array(Math.ceil(sampleRate * TAP_DURATION));
  const frequency = FREQUENCIES[lane] ?? FREQUENCIES[0];
  let seed = 12345 + lane * 7919, lowPass = 0, previousLowPass = 0, highPass = 0, peak = 0;
  const lowPassRate = 1 - Math.exp(-2 * Math.PI * 4500 / sampleRate);
  const highPassRate = Math.exp(-2 * Math.PI * 600 / sampleRate);
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 0xffffffff * 2 - 1;
    lowPass += lowPassRate * (noise - lowPass);
    highPass = highPassRate * (highPass + lowPass - previousLowPass);
    previousLowPass = lowPass;
    const click = 0.55 * highPass * Math.exp(-t / 0.006);
    const body = 0.45 * Math.sin(2 * Math.PI * frequency * t) * Math.exp(-t / 0.017)
      + 0.18 * Math.sin(2 * Math.PI * frequency * 2.1 * t) * Math.exp(-t / 0.01);
    const attack = Math.min(1, t / 0.001);
    const release = Math.min(1, (samples.length - 1 - i) / (sampleRate * 0.003));
    samples[i] = (click + body) * attack * release;
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  if (peak) for (let i = 0; i < samples.length; i++) samples[i] *= 0.8 / peak;
  return samples;
}

/** Reusable local sound buffers. Each input starts one voice; chords share a compressor. */
export class TapSound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers: AudioBuffer[] = [];
  private voices = new Set<AudioBufferSourceNode>();
  private disposed = false;
  private level = 70;
  private active = true;
  constructor(private onUnavailable: () => void) {}

  get enabled(): boolean { return this.active; }
  set enabled(enabled: boolean) { this.active = enabled; this.updateVolume(); }
  get volume(): number { return this.level; }
  set volume(volume: number) {
    this.level = Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : 70;
    this.updateVolume();
  }
  private updateVolume(): void {
    if (this.context && this.master && this.context.state !== 'closed') {
      this.master.gain.setTargetAtTime(this.active ? this.level / 100 * 0.55 : 0, this.context.currentTime, 0.008);
    }
  }

  play(lane: number): void {
    if (!this.enabled || this.volume === 0 || this.disposed) return;
    try {
      // Construct/resume in the input gesture for Safari's audio activation rules.
      const AudioContextClass = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) { this.onUnavailable(); return; }
      this.context ??= new AudioContextClass({ latencyHint: 'interactive' });
      const context = this.context;
      if (!this.master) this.prepare(context);
      if (context.state === 'running') this.click(context, lane);
      else void context.resume().then(() => {
        if (this.enabled && this.volume > 0 && !this.disposed && context.state === 'running') this.click(context, lane);
      }).catch(() => this.onUnavailable());
    } catch { this.onUnavailable(); }
  }

  private prepare(context: AudioContext): void {
    this.buffers = FREQUENCIES.map((_, lane) => {
      const samples = createTapSamples(context.sampleRate, lane);
      const buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.copyToChannel(samples, 0);
      return buffer;
    });
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 12;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.05;
    this.master = context.createGain();
    this.master.gain.value = this.level / 100 * 0.55;
    // Compression controls chord loudness; a soft ceiling also catches the first
    // transient of very fast overlapping inputs before the compressor reacts.
    const limiter = context.createWaveShaper();
    const curve = new Float32Array(1025);
    for (let i = 0; i < curve.length; i++) {
      const x = i / (curve.length - 1) * 2 - 1;
      const absolute = Math.abs(x);
      curve[i] = absolute <= 0.8 ? x : Math.sign(x) * (0.8 + 0.15 * Math.tanh((absolute - 0.8) / 0.15));
    }
    limiter.curve = curve; limiter.oversample = '2x';
    this.master.connect(compressor); compressor.connect(limiter); limiter.connect(context.destination);
  }

  private click(context: AudioContext, lane: number): void {
    // Keep all six simultaneous inputs audible, but bound node growth during rapid tapping.
    if (this.voices.size >= 12) {
      const oldest = this.voices.values().next().value!;
      oldest.stop(); this.voices.delete(oldest);
    }
    const source = context.createBufferSource();
    source.buffer = this.buffers[lane] ?? this.buffers[0];
    source.connect(this.master!);
    this.voices.add(source);
    source.onended = () => { source.disconnect(); this.voices.delete(source); };
    source.start(context.currentTime);
  }

  destroy(): void {
    this.disposed = true;
    this.voices.clear();
    if (this.context) void this.context.close().catch(() => {});
  }
}
