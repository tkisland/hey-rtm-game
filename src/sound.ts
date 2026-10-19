import { playbackSession } from './audio-session';
export const TAP_DURATION = 0.24;
export const MAX_LATE_TAP_MS = 80;
export const BEAT_DURATION = .09;
export interface SoundInputDiagnostic {
  id:number; lane:number; kind:string; atMs:number; state:string; activated:boolean;
  result:'pending'|'started'|'late-drop'|'cancelled'|'blocked'|'error';
  elapsedMs:number; contextTime:number|null; when?:number;
}
export interface SoundDiagnostics { enabled:boolean; volume:number; state:string; contextTime:number|null; requested:number; started:number; lateDrops:number; blocked:number; sessionType:string|null; firstInputs?:SoundInputDiagnostic[]; baseLatencyMs?:number|null; outputLatencyMs?:number|null }
type VoiceKind = 'tap' | 'box' | 'beat' | 'sweep';
export const BOX_SWEEP_GAP = .014;
let sweepSamples: Float32Array<ArrayBuffer> | null = null;
const SAMPLE_RATE = 48000;
const PITCHES = [0.98, 0.988, 0.996, 1.004, 1.012, 1.02];
export const BOX_PITCHES = [1046.502, 1174.659, 1318.51, 1567.982, 1760, 2093.005];
export const BOX_DURATION = 0.38;
const boxSamples: Float32Array<ArrayBuffer>[] = [];
let beatSamples: Float32Array<ArrayBuffer> | null = null;
const PARTIALS = [3420, 4781, 6127, 7919, 9343, 10867];
const tapSamples: Float32Array<ArrayBuffer>[] = [], holdSamples: Float32Array<ArrayBuffer>[] = [];
let warming = false;

/** Synthesize one lane per idle task, before gameplay; no AudioContext or audible warm-up. */
function warmSamples(): void {
  if (warming) return;
  warming = true;
  let lane = 0;
  const next = () => {
    beatSamples ??= createBeatSamples(SAMPLE_RATE);
    if (lane === 5) sweepSamples ??= createBoxSweepSamples(SAMPLE_RATE);
    tapSamples[lane] ??= createTapSamples(SAMPLE_RATE, lane);
    holdSamples[lane] ??= createHoldSamples(SAMPLE_RATE, lane);
    boxSamples[lane] ??= createBoxSamples(SAMPLE_RATE, lane);
    if (++lane < PITCHES.length) schedule();
  };
  const schedule = () => {
    if (window.requestIdleCallback) window.requestIdleCallback(next, { timeout: 500 });
    else window.setTimeout(next, 0);
  };
  schedule();
}

/** A short cymbal: bright filtered noise and inharmonic metal partials, without a pitched beep. */
export function createTapSamples(sampleRate: number, lane: number) {
  const samples = new Float32Array(Math.ceil(sampleRate * TAP_DURATION));
  const pitch = PITCHES[lane] ?? PITCHES[0];
  let seed = 12345 + lane * 7919, lowPass = 0, previousLowPass = 0, highPass = 0, peak = 0;
  const lowPassRate = 1 - Math.exp(-2 * Math.PI * 10000 / sampleRate);
  const highPassRate = Math.exp(-2 * Math.PI * 2600 / sampleRate);
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 0xffffffff * 2 - 1;
    lowPass += lowPassRate * (noise - lowPass);
    highPass = highPassRate * (highPass + lowPass - previousLowPass);
    previousLowPass = lowPass;
    const shimmer = highPass * (0.7 * Math.exp(-t / 0.025) + 0.3 * Math.exp(-t / 0.065));
    let metal = 0;
    for (const frequency of PARTIALS) metal += Math.sin(2 * Math.PI * frequency * pitch * t);
    metal *= 0.035 * Math.exp(-t / 0.045);
    const attack = Math.min(1, t / 0.0004);
    const release = Math.min(1, (samples.length - 1 - i) / (sampleRate * 0.012));
    samples[i] = (shimmer + metal) * attack * release;
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  if (peak) for (let i = 0; i < samples.length; i++) samples[i] *= 0.8 / peak;
  return samples;
}

/** Periodic metallic buzz with a 30Hz rattle. Integer cycles keep the loop seamless. */
export function createHoldSamples(sampleRate: number, lane: number) {
  const samples = new Float32Array(Math.round(sampleRate * 0.2));
  const frequency = 330 + lane * 10;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate, phase = 2 * Math.PI * frequency * t;
    const buzz = Math.sin(phase) * 0.5 + Math.sin(phase * 3) * 0.22 + Math.sin(phase * 5) * 0.12;
    const metal = Math.sin(2 * Math.PI * (2310 + lane * 20) * t) * 0.15
      + Math.sin(2 * Math.PI * (3790 + lane * 30) * t) * 0.08;
    const rattle = 0.65 + Math.sin(2 * Math.PI * 30 * t) * 0.35;
    samples[i] = (buzz + metal) * rattle;
    peak = Math.max(peak, Math.abs(samples[i]));
  }
  if (peak) for (let i = 0; i < samples.length; i++) samples[i] *= 0.45 / peak;
  return samples;
}

/** A rising six-note harp/bell run. Each gesture adds one note, never an automatic arpeggio. */
export function createBoxSamples(sampleRate: number, index: number) {
  const samples = new Float32Array(Math.ceil(sampleRate * BOX_DURATION));
  const frequency = BOX_PITCHES[index] ?? BOX_PITCHES[0];
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate, phase = 2 * Math.PI * frequency * t;
    const tone = Math.sin(phase) * Math.exp(-t / .12)
      + Math.sin(phase * 2) * .3 * Math.exp(-t / .065)
      + Math.sin(phase * 3.003) * .12 * Math.exp(-t / .04);
    const envelope = Math.min(1, t / .001) * Math.min(1, (samples.length - 1 - i) / (sampleRate * .025));
    samples[i] = tone * envelope; peak = Math.max(peak, Math.abs(samples[i]));
  }
  if (peak) for (let i = 0; i < samples.length; i++) samples[i] *= .48 / peak;
  return samples;
}

/** Six attacks in 70ms, synthesized together so sparse touch events still produce a run. */
export function createBoxSweepSamples(sampleRate: number) {
  const samples = new Float32Array(Math.ceil(sampleRate * (BOX_DURATION + BOX_SWEEP_GAP * 5)));
  for (let step = 0; step < 6; step++) {
    const tone = boxSamples[step] ??= createBoxSamples(SAMPLE_RATE, step);
    const data = sampleRate === SAMPLE_RATE ? tone : createBoxSamples(sampleRate, step);
    const start = Math.round(sampleRate * BOX_SWEEP_GAP * step);
    for (let i = 0; i < data.length && start + i < samples.length; i++) samples[start + i] += data[i];
  }
  let peak = 0; for (const value of samples) peak = Math.max(peak, Math.abs(value));
  if (peak) for (let i = 0; i < samples.length; i++) samples[i] *= .7 / peak;
  return samples;
}

/** A distinct, audible reference beat, also suitable for checking sound before practice. */
export function createBeatSamples(sampleRate: number) {
  const samples = new Float32Array(Math.ceil(sampleRate * BEAT_DURATION));
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, t / .001) * Math.exp(-t / .022)
      * Math.min(1, (samples.length - 1 - i) / (sampleRate * .008));
    samples[i] = (.58 * Math.sin(2 * Math.PI * 880 * t) + .12 * Math.sin(2 * Math.PI * 1760 * t)) * envelope;
  }
  return samples;
}

interface HoldVoice {
  requestedAt: number;
  source?: AudioBufferSourceNode;
  gain?: GainNode;
  when?: number;
}

/** Reusable local sound buffers. Each input starts one voice; chords share a compressor. */
export class TapSound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers: AudioBuffer[] = [];
  private boxBuffers: AudioBuffer[] = [];
  private beatBuffers: AudioBuffer[] = [];
  private sweepBuffers: AudioBuffer[] = [];
  private voices = new Map<AudioBufferSourceNode, number>();
  private holdBuffers: AudioBuffer[] = [];
  private holds = new Map<number, HoldVoice>();
  private disposed = false;
  private level = 70;
  private active = true;
  private delayMs = 0;
  private generation = 0;
  private playbackActive = false;
  private session = playbackSession();
  private readinessTimer = 0;
  private ready = false;
  private firstInputs: SoundInputDiagnostic[] = [];
  private requested = 0;
  private started = 0;
  private lateDrops = 0;
  private blocked = 0;
  private contextChanged = () => {
    if (this.context?.state === 'running') {
      clearTimeout(this.readinessTimer); this.readinessTimer = 0;
      if (!this.ready && !this.disposed) this.onReady?.();
      this.ready = true;
    } else { this.ready = false; if (this.playbackActive) this.watchReadiness(); }
  };
  private watchReadiness(): void {
    if (this.readinessTimer || this.context?.state === 'running') return;
    this.readinessTimer = window.setTimeout(() => {
      this.readinessTimer = 0;
      if (!this.disposed && this.playbackActive && this.enabled && this.volume > 0 && !document.hidden && this.context?.state !== 'running') this.onUnavailable();
    }, 1500);
  }
  /** Observations only: running/scheduled audio does not prove physical sound output. */
  diagnostics(): SoundDiagnostics {
    let sessionType:string|null = null;
    try { sessionType = (navigator as Navigator & {audioSession?:{type:string}}).audioSession?.type ?? null; } catch { /* optional API */ }
    return {enabled:this.enabled,volume:this.volume,state:this.context?.state ?? 'uninitialized',contextTime:this.context?.currentTime ?? null,requested:this.requested,started:this.started,lateDrops:this.lateDrops,blocked:this.blocked,sessionType,
      ...(this.traceInputs ? {firstInputs:this.firstInputs.map(input=>({...input})),
        baseLatencyMs:this.context && Number.isFinite(this.context.baseLatency) ? this.context.baseLatency * 1000 : null,
        outputLatencyMs:this.context && Number.isFinite(this.context.outputLatency) ? this.context.outputLatency * 1000 : null} : {})};
  }
  private outputWarmup: ConstantSourceNode | null = null;
  private visibilityChanged = () => { if (document.hidden) this.cancelPending(); };
  private activate = (event: Event) => { if (event.isTrusted && !document.hidden) void this.unlock(); };
  /** An optional context shares a reference clock; this instance closes it on destroy. */
  constructor(private onUnavailable: () => void, context?: AudioContext, private onReady?: () => void, private traceInputs = false) {
    this.context = context ?? null;
    warmSamples();
    document.addEventListener('visibilitychange', this.visibilityChanged);
    document.addEventListener('pointerdown', this.activate, { capture: true, passive: true });
    document.addEventListener('keydown', this.activate, { capture: true });
    // Touch activation can be granted at release, after pointerdown has already run.
    document.addEventListener('pointerup', this.activate, { capture: true, passive: true });
    document.addEventListener('touchend', this.activate, { capture: true, passive: true });
  }

  get enabled(): boolean { return this.active; }
  set enabled(enabled: boolean) { this.active = enabled; if (!enabled) this.cancelPending(); this.updateVolume(); this.syncOutputWarmup(); }
  get volume(): number { return this.level; }
  set volume(volume: number) {
    this.level = Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : 70;
    if (!this.level) this.cancelPending();
    this.updateVolume();
    this.syncOutputWarmup();
  }
  get delay(): number { return this.delayMs; }
  set delay(value: number) {
    const next = Number.isFinite(value) ? Math.max(0, Math.min(300, value)) : 0;
    if (next !== this.delayMs) { this.cancelPending(); this.delayMs = next; }
  }
  /** Drop future clicks, active holds and delayed resumes; preserve one-shot sounds already playing. */
  cancelPending(): void {
    this.generation++;
    for (const input of this.firstInputs) if (input.result === 'pending') this.finishInput(input, 'cancelled');
    if (!this.playbackActive || !this.enabled || !this.volume || this.disposed) this.session.release();
    this.stopOutputWarmup();
    for (const lane of this.holds.keys()) this.stopHold(lane);
    for (const [source, when] of this.voices) {
      if (this.context && when > this.context.currentTime) {
        try { source.stop(); } catch { /* The node may have just ended. */ }
        source.disconnect(); this.voices.delete(source);
      }
    }
  }

  /** Keep the output processing silence during playback, before the first note and through gaps. */
  setPlaybackActive(active: boolean): void {
    this.playbackActive = active;
    this.syncOutputWarmup();
  }
  private syncOutputWarmup(): void {
    const context = this.context;
    if (!this.playbackActive || !this.enabled || !this.volume || this.disposed || document.hidden) {
      this.stopOutputWarmup(); return;
    }
    if (!context || !this.master) return;
    this.session.acquire();
    if (this.outputWarmup) return;
    try {
      const source = context.createConstantSource();
      source.offset.value = 0; // Exact digital silence through the same compressor/output as taps.
      this.outputWarmup = source; source.connect(this.master); source.start();
    } catch { this.stopOutputWarmup(); this.onUnavailable(); }
  }
  private stopOutputWarmup(): void {
    const source = this.outputWarmup; this.outputWarmup = null;
    if (!source) return;
    try { source.stop(); } catch { /* Already stopped or closed. */ }
    source.disconnect();
  }

  /** Reconcile real held notes. Audio activation still comes from play()/unlock() in a gesture. */
  syncHolds(lanes: ReadonlySet<number>, requestedAt = performance.now()): void {
    const allowed = this.enabled && this.volume > 0 && !this.disposed && !document.hidden;
    for (const lane of this.holds.keys()) if (!allowed || !lanes.has(lane)) this.stopHold(lane);
    const context = this.context;
    if (!allowed || !context || !this.master) return;
    for (const lane of lanes) {
      if (!Number.isInteger(lane) || lane < 0 || lane >= 6) continue;
      let voice = this.holds.get(lane);
      if (!voice) { voice = { requestedAt }; this.holds.set(lane, voice); }
      if (voice.source || context.state !== 'running') continue;
      try {
        if (!this.holdBuffers[lane]) {
          const samples = holdSamples[lane] ??= createHoldSamples(SAMPLE_RATE, lane);
          const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
          buffer.copyToChannel(samples, 0); this.holdBuffers[lane] = buffer;
        }
        const source = context.createBufferSource(), gain = context.createGain();
        const when = context.currentTime + Math.max(0, this.delayMs - (performance.now() - voice.requestedAt)) / 1000;
        source.buffer = this.holdBuffers[lane]; source.loop = true;
        gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(1, when + 0.012);
        source.connect(gain); gain.connect(this.master);
        voice.source = source; voice.gain = gain; voice.when = when;
        const current = voice;
        source.onended = () => {
          source.disconnect(); gain.disconnect();
          if (this.holds.get(lane) === current) this.holds.delete(lane);
        };
        source.start(when);
      } catch { this.stopHold(lane); this.onUnavailable(); }
    }
  }

  private stopHold(lane: number): void {
    const voice = this.holds.get(lane); this.holds.delete(lane);
    if (!voice?.source || !voice.gain || !this.context) return;
    const context = this.context, gain = voice.gain.gain, now = context.currentTime;
    try {
      if (context.state !== 'running' || voice.when! > now) {
        voice.source.stop(); voice.source.disconnect(); voice.gain.disconnect();
      } else {
        const level = gain.value;
        gain.cancelScheduledValues(now); gain.setValueAtTime(level, now);
        gain.linearRampToValueAtTime(0, now + 0.012); voice.source.stop(now + 0.014);
      }
    } catch { voice.source.disconnect(); voice.gain.disconnect(); }
  }
  private updateVolume(): void {
    if (this.context && this.master && this.context.state !== 'closed') {
      this.master.gain.setTargetAtTime(this.active ? this.level / 100 * 0.55 : 0, this.context.currentTime, 0.008);
    }
  }

  /** Prepare audio in a user gesture without playing a warm-up click. */
  async unlock(): Promise<boolean> {
    if (this.disposed) return false;
    if (!this.enabled || this.volume === 0) return true;
    const generation = this.generation;
    try {
      this.session.acquire();
      const AudioContextClass = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error('Audio unavailable');
      this.context ??= new AudioContextClass({ latencyHint: 'interactive' });
      if (!this.master) this.prepare(this.context);
      this.syncOutputWarmup();
      if (this.context.state !== 'running') { this.watchReadiness(); await this.context.resume(); }
      this.contextChanged();
      const ready = generation === this.generation && !this.disposed && this.context.state === 'running';
      if (!ready && generation === this.generation && !this.disposed) this.onUnavailable();
      return ready;
    } catch {
      if (generation === this.generation && !this.disposed) this.onUnavailable();
      return false;
    }
  }

  play(lane: number): void { this.playVoice(lane); }
  playBeat(): void { this.playVoice(0, 'beat'); }
  playBoxSweep(): void { this.playVoice(0, 'sweep'); }
  playBox(step: number): void {
    if (Number.isInteger(step) && step >= 1 && step <= 6) this.playVoice(step - 1, 'box');
  }
  private playVoice(lane: number, kind: VoiceKind = 'tap'): void {
    if (!this.enabled || this.volume === 0 || this.disposed) return;
    let observation: SoundInputDiagnostic | undefined;
    const requestedAt = performance.now();
    try {
      this.requested++;
      if (this.traceInputs && this.firstInputs.length < 8) {
        observation = {id:this.requested,lane,kind,atMs:requestedAt,state:this.context?.state ?? 'uninitialized',
          activated:navigator.userActivation?.isActive ?? false,result:'pending',elapsedMs:0,contextTime:this.context?.currentTime ?? null};
        this.firstInputs.push(observation);
      }
      const delay = kind === 'beat' ? 0 : this.delayMs, generation = this.generation;
      // Construct/resume in the input gesture for Safari's audio activation rules.
      this.session.acquire();
      const AudioContextClass = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) { this.finishInput(observation, 'error'); this.onUnavailable(); return; }
      this.context ??= new AudioContextClass({ latencyHint: 'interactive' });
      const context = this.context;
      if (!this.master) this.prepare(context);
      this.syncOutputWarmup();
      const remaining = () => Math.max(0, delay - (performance.now() - requestedAt)) / 1000;
      const playCurrent = () => {
        // Do not replay a backlog when an output device / suspended context starts late.
        if (generation !== this.generation || !this.enabled || this.volume === 0 || this.disposed || document.hidden) { this.finishInput(observation, 'cancelled'); return; }
        this.contextChanged();
        if (context.state !== 'running') { this.finishInput(observation, 'blocked'); this.blocked++; this.onUnavailable(); return; }
        if (performance.now() - requestedAt > delay + MAX_LATE_TAP_MS) { this.finishInput(observation, 'late-drop'); this.lateDrops++; return; }
        const when = this.click(context, lane, remaining(), kind);
        this.finishInput(observation, 'started', when);
      };
      if (context.state === 'running') playCurrent();
      else {
        this.watchReadiness();
        void context.resume().then(playCurrent).catch(() => { if (generation === this.generation && !this.disposed) { this.finishInput(observation, 'error'); this.blocked++; this.onUnavailable(); } });
      }
    } catch { this.finishInput(observation, 'error'); this.onUnavailable(); }
  }

  private finishInput(input:SoundInputDiagnostic|undefined, result:SoundInputDiagnostic['result'], when?:number): void {
    if (!input) return;
    input.result = result; input.elapsedMs = performance.now() - input.atMs;
    if (when !== undefined) input.when = when;
  }
  private prepare(context: AudioContext): void {
    context.addEventListener('statechange', this.contextChanged);
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

  private click(context: AudioContext, lane: number, delay: number, kind: VoiceKind): number {
    lane = Number.isInteger(lane) && lane >= 0 && lane < 6 ? lane : 0;
    const buffers = kind === 'box' ? this.boxBuffers : kind === 'beat' ? this.beatBuffers : kind === 'sweep' ? this.sweepBuffers : this.buffers;
    if (!buffers[lane]) {
      const samples = kind === 'sweep' ? (sweepSamples ??= createBoxSweepSamples(SAMPLE_RATE)) : kind === 'beat' ? (beatSamples ??= createBeatSamples(SAMPLE_RATE))
        : kind === 'box' ? (boxSamples[lane] ??= createBoxSamples(SAMPLE_RATE, lane)) : (tapSamples[lane] ??= createTapSamples(SAMPLE_RATE, lane));
      const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
      buffer.copyToChannel(samples, 0); buffers[lane] = buffer;
    }
    // Keep all six simultaneous inputs audible, but bound node growth during rapid tapping.
    if (this.voices.size >= 12) {
      const oldest = this.voices.keys().next().value!;
      oldest.stop(); this.voices.delete(oldest);
    }
    const source = context.createBufferSource();
    source.buffer = buffers[lane];
    source.connect(this.master!);
    const when = context.currentTime + delay;
    this.voices.set(source, when);
    source.onended = () => { source.disconnect(); this.voices.delete(source); };
    source.start(when);
    this.started++;
    return when;
  }

  destroy(): void {
    this.disposed = true;
    this.session.release();
    clearTimeout(this.readinessTimer);
    this.context?.removeEventListener('statechange', this.contextChanged);
    this.cancelPending();
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    document.removeEventListener('pointerdown', this.activate, true);
    document.removeEventListener('keydown', this.activate, true);
    document.removeEventListener('pointerup', this.activate, true);
    document.removeEventListener('touchend', this.activate, true);
    this.voices.clear();
    if (this.context) void this.context.close().catch(() => {});
  }
}
