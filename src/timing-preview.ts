import './timing-preview.css';
import './penlight.css';
import { LANE_COLORS } from './colors';
import type { Chart } from './chart';
import { GameEngine, judge } from './engine';
import { bindInput, KEYS } from './input';
import { bindTargets } from './field-geometry';
import { decoratePenlight } from './penlight';
import { Renderer } from './renderer';
import { INPUT_OFFSET_LIMIT_MS, NOTE_TRAVEL_SECONDS } from './settings';
import { compensateInput } from './timing';
import { NoteTimingCalibration } from './calibration';
import { TapSound } from './sound';

const INTERVAL = .9, WARMUP = 4, NOTES = 24;
type Callbacks = {
  pause(): void;
  settings(): { inputOffset: number };
  apply(offset: number): void;
};

/** An isolated rehearsal: the candidate offset affects the same renderer and engine as play. */
export function createTimingPreview(callbacks: Callbacks) {
  const dialog = document.createElement('dialog');
  dialog.className = 'timing-preview';
  dialog.setAttribute('aria-labelledby', 'timing-preview-title');
  dialog.innerHTML = `
    <h2 id="timing-preview-title">ノーツを見て入力補正</h2>
    <p class="timing-instructions">音に合わせて同じ色を押すと、ずれを自動補正します。PCは S D F / J K L。</p>
    <div class="timing-field"><canvas aria-label="入力補正を試す6レーンの練習ノーツ"></canvas><div class="timing-pads"></div></div>
    <div class="timing-adjustment">
      <label for="timing-preview-offset">入力補正（試し中）<output id="timing-preview-value">0 ms</output></label>
      <div class="timing-range"><button id="timing-preview-minus" type="button" aria-label="入力補正を5ミリ秒減らす">−5</button><input id="timing-preview-offset" type="range" min="-${INPUT_OFFSET_LIMIT_MS}" max="${INPUT_OFFSET_LIMIT_MS}" step="5" value="0" /><button id="timing-preview-plus" type="button" aria-label="入力補正を5ミリ秒増やす">＋5</button></div>
      <p class="timing-direction">ノーツが音より早い → ＋ ／ 遅い → −</p>
      <p id="timing-preview-auto" role="status" aria-live="polite">8回以上タップすると自動補正します。</p>
      <output id="timing-preview-feedback" role="status" aria-live="polite">「試す」で4拍の準備からスタート。</output>
    </div>
    <div class="timing-preview-actions"><button id="timing-preview-start" type="button">試す</button><button id="timing-preview-apply" type="button">適用</button><button id="timing-preview-close" type="button">キャンセル</button></div>
    <details class="timing-preview-help"><summary>調整のヒント・音量</summary>
      <p>上の横線が判定位置です。直近10回のうち8回以上の安定したタップから補正し、ノーツの到達と判定にすぐ反映します。ばらつきが大きい場合は値を変えません。手動で微調整すると測定をやり直します。「適用」するまで保存しません。</p>
      <label>基準音・ノーツ音の音量<input id="timing-preview-volume" type="range" min="10" max="100" step="10" value="70" /></label>
      <label><input id="timing-preview-cymbal" type="checkbox" checked />ノーツ音を鳴らす</label>
      <p>入力時は本番と同じノーツ音を鳴らします。この画面の音設定はゲームの設定を変更しません。基準音とMVでは音のずれが異なる場合があるので、適用後は実際の曲でも確認してください。Bluetoothのタップ音の遅れを短縮する機能ではありません。</p>
    </details>`;
  document.body.append(dialog);
  const find = <T extends HTMLElement>(id: string) => dialog.querySelector<T>(`#${id}`)!;
  const slider = find<HTMLInputElement>('timing-preview-offset');
  const value = find('timing-preview-value'), feedback = find('timing-preview-feedback');
  const autoStatus = find('timing-preview-auto');
  const startButton = find<HTMLButtonElement>('timing-preview-start');
  const applyButton = find<HTMLButtonElement>('timing-preview-apply');
  const volume = find<HTMLInputElement>('timing-preview-volume');
  const cymbalToggle = find<HTMLInputElement>('timing-preview-cymbal');
  const canvas = dialog.querySelector('canvas')!;
  const pads = dialog.querySelector('.timing-pads')!;
  const targets: HTMLElement[] = [], labels: HTMLOutputElement[] = [];
  const buttons = LANE_COLORS.map((color, lane) => {
    const target = document.createElement('div'); target.className = 'timing-target'; target.style.setProperty('--lane', color);
    const receptor = document.createElement('i'); receptor.className = 'lane-receptor'; receptor.setAttribute('aria-hidden', 'true');
    const button = document.createElement('button'); button.type = 'button'; button.className = 'timing-pad'; button.textContent = KEYS[lane].slice(-1);
    button.setAttribute('aria-label', `練習レーン${lane + 1} ${KEYS[lane].slice(-1)}`); decoratePenlight(button);
    const label = document.createElement('output'); label.className = 'timing-judgement'; label.hidden = true;
    target.append(receptor, button, label); pads.append(target); targets.push(target); labels.push(label); return button;
  });
  const events = new AbortController(), signal = events.signal;
  let renderer: Renderer | null = null, audio: AudioContext | null = null;
  let master: GainNode | null = null, tones: OscillatorNode[] = [];
  let engine: GameEngine | null = null, candidate = 0, cymbal: TapSound | null = null;
  let frame = 0, token = 0, preparing = false, prepareTimer = 0, previousTime = 0;
  let unbind = () => {}, unbindTargets = () => {}, resize: ResizeObserver | null = null;
  let returnFocus: HTMLElement | null = null;
  const measured = new NoteTimingCalibration(), hitTimes = Array<number>(6).fill(-Infinity);
  // iOS playback sessions allow explicit reference sound even with the ringer muted.
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  let previousSession: string | null = null;
  function stop(): void {
    token++; preparing = false; clearTimeout(prepareTimer); cancelAnimationFrame(frame); frame = 0;
    unbind(); unbind = () => {};
    tones.forEach(tone => { try { tone.stop(); } catch { /* already ended */ } tone.disconnect(); }); tones = [];
    master?.disconnect(); master = null;
    cymbal?.destroy(); cymbal = null;
    const oldAudio = audio; audio = null; void oldAudio?.close().catch(() => {});
    if (session && previousSession !== null) {
      try { if (session.type === 'playback') session.type = previousSession; } catch { /* optional API */ }
      previousSession = null;
    }
    if (renderer) renderer.pressed = new Set();
    startButton.disabled = false;
  }
  function draw(now: number, time: number): void {
    if (!renderer) return;
    renderer.draw(engine?.notes ?? [], time, NOTE_TRAVEL_SECONDS, now, { inputOffsetMs: candidate, playing: audio?.state === 'running', chart: engine?.chart });
    labels.forEach((label, lane) => { if (now - hitTimes[lane] > 800) label.hidden = true; });
  }
  function report(message: string): void { feedback.textContent = message; }
  function interrupted(message: string): void { stop(); report(message); }
  function tap(lane: number): void {
    if (!audio || audio.state !== 'running' || !engine || !renderer) return;
    const now = performance.now(), rawTime = audio.currentTime;
    // Sample the input first; sound preparation must never shift the measured timestamp.
    cymbal?.play(lane);
    // Also explain taps outside GOOD, so a large initial offset can still be adjusted.
    const nearest = engine.notes.filter(note => note.lane === lane && !measured.has(note.id) && note.state !== 'hit')
      .sort((a, b) => Math.abs(a.time - rawTime) - Math.abs(b.time - rawTime))[0];
    if (!nearest) { report('音とノーツに合わせて、同じ色のボタンを押してください。'); return; }
    const result = measured.tap(nearest.id, rawTime, nearest.time);
    if (!result) { report('音とノーツに合わせて、同じ色のボタンを押してください。'); return; }
    if (result.ok) {
      const previous = candidate;
      setCandidate(result.offset, true);
      // Rebuild only the rehearsal when its clock changes, recovering heads that the old
      // correction had already expired. Measured IDs remain sealed against double taps.
      if (candidate !== previous) engine.seek(compensateInput(rawTime, candidate), true);
      autoStatus.textContent = `自動反映：${candidate > 0 ? '+' : ''}${candidate} ms · 有効${result.samples}回`;
    } else {
      autoStatus.textContent = result.reason === 'insufficient' ? `自動測定 ${measured.count} / 8回`
        : result.reason === 'range' ? 'ずれが補正範囲（±300ms）を超えています。音声機器を確認してください。'
        : 'ばらつきがあります。音に合わせて続けてください。';
    }
    const time = compensateInput(rawTime, candidate);
    const error = (time - nearest.time) * 1000, judgement = judge(error / 1000);
    engine.input(lane, time); engine.advance(time, renderer.pressed);
    if (judgement !== 'MISS') renderer.flash(lane, now, judgement);
    labels[lane].hidden = false; labels[lane].textContent = judgement; hitTimes[lane] = now;
    labels[lane].dataset.kind = judgement;
    const detail = Math.abs(error) < .5 ? 'ずれ 0 ms' : `${error > 0 ? '遅い' : '早い'} ${error > 0 ? '+' : ''}${Math.round(error)} ms`;
    report(`${judgement} · ${detail}`);
    draw(now, rawTime);
  }
  function tick(now: number): void {
    if (!audio || !engine) return;
    const time = audio.currentTime;
    if (audio.state !== 'running' || time < previousTime || time - previousTime > 1.5) {
      interrupted('再生を中断しました。「試す」で再開できます。'); return;
    }
    previousTime = time;
    engine.advance(compensateInput(time, candidate), renderer!.pressed);
    draw(now, time);
    if (time > engine.chart.notes.at(-1)!.time + .8) {
      stop(); startButton.textContent = 'もう一度'; report('練習終了。補正を変えて再度試すか、「適用」で保存してください。'); return;
    }
    frame = requestAnimationFrame(tick);
  }
  async function start(): Promise<void> {
    stop(); engine = null; measured.clear(); labels.forEach(label => { label.hidden = true; });
    autoStatus.textContent = '8回以上タップすると自動補正します。';
    renderer?.clearEffects(); draw(performance.now(), 0);
    preparing = true; startButton.disabled = true; report('基準音を準備しています…');
    const current = token;
    prepareTimer = window.setTimeout(() => {
      if (current === token) interrupted('音声の準備が完了しません。「試す」で再試行してください。');
    }, 5000);
    try {
      if (session) { try { previousSession = session.type; session.type = 'playback'; } catch { previousSession = null; } }
      const context = new AudioContext({ latencyHint: 'interactive' }); audio = context;
      cymbal = new TapSound(() => report('ノーツ音を再生できません。音量を確認し、「試す」で再試行してください。'), context);
      cymbal.volume = Number(volume.value); cymbal.enabled = cymbalToggle.checked;
      cymbal.setPlaybackActive(true);
      // Activate both paths in the same user gesture, sharing one audio clock/output.
      const resumed = context.resume(), ready = cymbal.unlock();
      const [, soundReady] = await Promise.all([resumed, ready]);
      if (current !== token || !dialog.open) return;
      if (context.state !== 'running' || !soundReady) throw new Error('Audio unavailable');
      clearTimeout(prepareTimer); preparing = false; previousTime = context.currentTime;
      const firstBeat = context.currentTime + .8;
      const firstNote = firstBeat + WARMUP * INTERVAL;
      const chart: Chart = { videoId: '', title: '入力補正の練習', bpm: 60 / INTERVAL, startTime: firstNote, beatOrigin: firstBeat,
        notes: Array.from({ length: NOTES }, (_, i) => ({ id: i + 1, time: firstNote + i * INTERVAL, lane: [2,3,1,4,0,5][i % 6], type: 'tap' })) };
      engine = new GameEngine(chart);
      master = context.createGain(); master.gain.value = Number(volume.value) / 100 * .35; master.connect(context.destination);
      for (let beat = 0; beat < WARMUP + NOTES; beat++) {
        const when = firstBeat + beat * INTERVAL;
        const tone = context.createOscillator(), envelope = context.createGain(); tone.frequency.value = 1200;
        envelope.gain.setValueAtTime(0, when); envelope.gain.linearRampToValueAtTime(1, when + .003);
        envelope.gain.exponentialRampToValueAtTime(.001, when + .055);
        tone.connect(envelope); envelope.connect(master);
        tone.onended = () => { tone.disconnect(); envelope.disconnect(); };
        tones.push(tone); tone.start(when); tone.stop(when + .06);
      }
      unbind = bindInput(buttons, lane => tap(lane), lanes => { if (renderer) renderer.pressed = lanes; }, () => !audio || audio.state !== 'running');
      startButton.textContent = '最初から試す'; startButton.disabled = false;
      report('準備の4拍を聞いたら、音とノーツに合わせて押してください。');
      // Keep keyboard input out of the range while retaining a stable mobile viewport.
      buttons[2].focus({ preventScroll: true });
      tick(performance.now());
    } catch { if (current === token) interrupted('基準音を再生できません。端末の音量を確認し、「試す」で再試行してください。'); }
  }
  function setCandidate(next: number, automatic = false): void {
    candidate = Math.round(Math.max(-INPUT_OFFSET_LIMIT_MS, Math.min(INPUT_OFFSET_LIMIT_MS, next)) / 5) * 5 || 0;
    slider.value = String(candidate); value.textContent = `${candidate > 0 ? '+' : ''}${candidate} ms`;
    find<HTMLButtonElement>('timing-preview-minus').disabled = candidate === -INPUT_OFFSET_LIMIT_MS;
    find<HTMLButtonElement>('timing-preview-plus').disabled = candidate === INPUT_OFFSET_LIMIT_MS;
    if (!automatic) {
      measured.clear(); labels.forEach(label => { label.hidden = true; }); renderer?.clearEffects();
      if (engine && audio) engine.seek(compensateInput(audio.currentTime, candidate), true);
      autoStatus.textContent = '8回以上タップすると自動補正します。';
      report('試し中の補正を変更しました。音とノーツの重なりを確認してください。');
    }
    if (!automatic) draw(performance.now(), audio?.currentTime ?? 0);
  }
  slider.addEventListener('input', () => setCandidate(slider.valueAsNumber), { signal });
  // Keep arrow-key editing on ranges while allowing S/D/F/J/K/L to try a note immediately.
  for (const control of [slider, volume]) control.addEventListener('keydown', event => {
    const lane = KEYS.indexOf(event.code);
    if (lane < 0 || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    if (!event.repeat) tap(lane);
  }, { signal });
  find('timing-preview-minus').addEventListener('click', () => setCandidate(candidate - 5), { signal });
  find('timing-preview-plus').addEventListener('click', () => setCandidate(candidate + 5), { signal });
  volume.addEventListener('input', () => {
    if (master) master.gain.value = Number(volume.value) / 100 * .35;
    if (cymbal) cymbal.volume = Number(volume.value);
  }, { signal });
  cymbalToggle.addEventListener('change', () => { if (cymbal) cymbal.enabled = cymbalToggle.checked; }, { signal });
  startButton.addEventListener('click', () => void start(), { signal });
  applyButton.addEventListener('click', () => { callbacks.apply(candidate); dialog.close(); }, { signal });
  find('timing-preview-close').addEventListener('click', () => dialog.close(), { signal });
  function cleanup(): void {
    stop(); resize?.disconnect(); resize = null; unbindTargets(); unbindTargets = () => {};
    renderer?.destroy(); renderer = null; engine = null;
  }
  dialog.addEventListener('close', () => { cleanup(); returnFocus?.focus({ preventScroll: true }); }, { signal });
  dialog.addEventListener('cancel', cleanup, { signal });
  const interrupt = () => { if (dialog.open && (audio || preparing)) interrupted('再生を中断しました。「試す」で再開できます。'); };
  window.addEventListener('blur', interrupt, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) interrupt(); }, { signal });
  return {
    get active() { return dialog.open; },
    open() {
      if (dialog.open) return;
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const settings = callbacks.settings();
      applyButton.disabled = false;
      try { callbacks.pause(); } catch {
        dialog.showModal(); startButton.disabled = true; applyButton.disabled = true;
        report('MVを一時停止できません。動画を停止してから、もう一度この画面を開いてください。'); return;
      }
      dialog.showModal(); renderer = new Renderer(canvas);
      unbindTargets = bindTargets(canvas, targets);
      setCandidate(settings.inputOffset); report('「試す」で4拍の準備からスタート。');
      startButton.textContent = '試す';
      resize = new ResizeObserver(() => draw(performance.now(), audio?.currentTime ?? 0)); resize.observe(canvas);
      dialog.scrollTop = 0;
    },
    destroy() { cleanup(); events.abort(); dialog.close(); dialog.remove(); },
  };
}
