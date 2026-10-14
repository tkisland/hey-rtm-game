import './calibration.css';
import { CALIBRATION, CalibrationMeasurement } from './calibration';
import type { CalibrationResult } from './calibration';

export function createCalibrationDialog(callbacks: { pause(): void; apply(offset: number): void }): {
  readonly active: boolean; open(): void; destroy(): void;
} {
  const dialog = document.createElement('dialog');
  dialog.className = 'calibration-dialog';
  dialog.setAttribute('aria-labelledby', 'calibration-title');
  dialog.innerHTML = `
    <h2 id="calibration-title">基準音で入力を自動調整</h2>
    <p>準備の4拍を聞いた後、同じ間隔で鳴る10拍に合わせてタップしてください。画面ではなく音に合わせます。</p>
    <p class="field-help">PCは S / D / F / J / K / L またはスペース。スマホは下のボタンをタップ。測定中はタップ音を鳴らしません。</p>
    <label class="calibration-volume">基準音の音量 <input id="calibration-volume" aria-label="基準音の音量" type="range" min="10" max="100" step="10" value="70" /></label>
    <p id="calibration-status" role="status" aria-live="polite">いつも使うスピーカー・イヤホンで測定してください。</p>
    <progress id="calibration-progress" max="10" value="0" aria-label="測定済みタップ数"></progress>
    <button id="calibration-tap" class="calibration-tap" disabled>音に合わせてタップ</button>
    <div class="calibration-actions"><button id="calibration-start">測定を開始</button><button id="calibration-apply" disabled>補正を適用</button><button id="calibration-close">閉じる</button></div>
    <p class="field-help">音の出力・操作を含むずれから入力補正の目安を求めます。MVで確認し、必要なら微調整してください。測定結果は以前の入力補正を置き換えます。タップ音の追加遅延は変えません。</p>`;
  document.body.append(dialog);
  const find = <T extends HTMLElement>(id: string) => dialog.querySelector<T>(`#${id}`)!;
  const status = find('calibration-status'), tapButton = find<HTMLButtonElement>('calibration-tap');
  const startButton = find<HTMLButtonElement>('calibration-start'), applyButton = find<HTMLButtonElement>('calibration-apply');
  const volume = find<HTMLInputElement>('calibration-volume'), progress = find<HTMLProgressElement>('calibration-progress');
  const events = new AbortController(), signal = events.signal;
  let context: AudioContext | null = null, gain: GainNode | null = null;
  let tones: OscillatorNode[] = [], measurement: CalibrationMeasurement | null = null;
  let result: CalibrationResult | null = null, frame = 0, generation = 0, starting = false, previousTime = 0;
  let returnFocus: HTMLElement | null = null;
  let prepareTimer = 0;
  const held = new Set<string>();
  function stop(): void {
    generation++; starting = false; clearTimeout(prepareTimer);
    cancelAnimationFrame(frame);
    tones.forEach(tone => { try { tone.stop(); } catch { /* already ended */ } tone.disconnect(); });
    tones = []; measurement = null; held.clear();
    tapButton.disabled = true; startButton.disabled = false; volume.disabled = false;
    gain?.disconnect(); gain = null;
    // Release the audio device between attempts; a fresh user gesture resumes the next context.
    const oldContext = context; context = null;
    void oldContext?.close().catch(() => {});
  }
  function interrupted(text: string): void {
    stop(); result = null; applyButton.disabled = true; status.textContent = text;
  }
  function finish(): void {
    const measured = measurement!.result();
    stop(); result = measured; startButton.textContent = 'もう一度測定';
    applyButton.disabled = !measured.ok;
    if (measured.ok) {
      const offset = `${measured.offset > 0 ? '+' : ''}${measured.offset}`;
      status.textContent = `入力補正の目安：${offset} ms（有効なタップ ${measured.samples}/10・ばらつき ${measured.spread} ms）。「補正を適用」で保存します。`;
    } else {
      const messages = {
        insufficient: 'タップが足りませんでした。準備の4拍の後、10拍続けて音に合わせてタップしてください。',
        unstable: 'タップの間隔にばらつきがあります。音に合わせて、もう一度測定してください。',
        range: 'ずれが補正範囲（±300ms）を超えています。音声機器・タップする拍を確認し、もう一度測定してください。',
      };
      status.textContent = `${messages[measured.reason]} 入力補正は変更していません。`;
    }
  }
  function tick(): void {
    if (!context || !measurement) return;
    const now = context.currentTime;
    if (context.state !== 'running' || now - previousTime > 1.5 || now < previousTime) {
      interrupted('音声または画面の更新が中断されました。もう一度測定してください。'); return;
    }
    previousTime = now;
    if (now > measurement.end) { finish(); return; }
    // Show only the phase and accepted count; avoid a visual timing cue that biases audio measurement.
    const text = now < measurement.firstMeasured - CALIBRATION.window
      ? '準備の4拍を聞いてください。そのまま続けて音に合わせてタップします。'
      : `音に合わせてタップしてください · 測定 ${measurement.taps.size}/10`;
    if (status.textContent !== text) status.textContent = text;
    frame = requestAnimationFrame(tick);
  }
  async function start(): Promise<void> {
    stop(); result = null; applyButton.disabled = true; progress.value = 0;
    tapButton.textContent = '音に合わせてタップ';
    starting = true; startButton.disabled = true; volume.disabled = true;
    status.textContent = '基準音を準備しています…';
    const token = generation;
    prepareTimer = window.setTimeout(() => {
      if (token === generation) interrupted('音声の準備が完了しませんでした。音声設定を確認し、もう一度測定してください。');
    }, 5000);
    try {
      const audio = new AudioContext({ latencyHint: 'interactive' }); context = audio;
      await audio.resume();
      if (token !== generation || !dialog.open) return;
      clearTimeout(prepareTimer);
      if (audio.state !== 'running') throw new Error('Audio unavailable');
      starting = false; previousTime = audio.currentTime;
      const session = new CalibrationMeasurement(audio.currentTime + 0.8); measurement = session;
      const master = audio.createGain(); master.gain.value = Number(volume.value) / 100 * 0.35;
      master.connect(audio.destination); gain = master;
      // Audio-clock scheduling keeps the reference regular even between animation frames.
      for (let beat = 0; beat < CALIBRATION.warmup + CALIBRATION.beats; beat++) {
        const when = session.firstBeat + beat * CALIBRATION.interval;
        const tone = audio.createOscillator(), envelope = audio.createGain();
        tone.frequency.value = 1200; tone.type = 'sine';
        envelope.gain.setValueAtTime(0, when);
        envelope.gain.linearRampToValueAtTime(1, when + 0.003);
        envelope.gain.exponentialRampToValueAtTime(0.001, when + 0.055);
        tone.connect(envelope); envelope.connect(master);
        tone.onended = () => { tone.disconnect(); envelope.disconnect(); };
        tones.push(tone); tone.start(when); tone.stop(when + 0.06);
      }
      tapButton.disabled = false;
      tapButton.focus({ preventScroll: true });
      tick();
    } catch {
      if (token === generation) interrupted('基準音を再生できません。端末の音量・ブラウザの音声設定を確認し、もう一度測定してください。');
    }
  }
  function tap(): void {
    if (!context || context.state !== 'running' || !measurement) return;
    if (measurement.tap(context.currentTime)) {
      progress.value = measurement.taps.size;
      // Immediate local feedback, without a sound or an audio-synchronized animation.
      tapButton.textContent = `タップ ${measurement.taps.size}/10`;
    }
  }
  startButton.addEventListener('click', () => { void start(); }, { signal });
  tapButton.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); tap();
  }, { signal });
  // Assistive-technology activation has no pointerdown. Native keyboard clicks are suppressed below.
  tapButton.addEventListener('click', event => { if (event.detail === 0) tap(); }, { signal });
  applyButton.addEventListener('click', () => {
    if (!result?.ok) return;
    callbacks.apply(result.offset); dialog.close();
  }, { signal });
  find('calibration-close').addEventListener('click', () => dialog.close(), { signal });
  dialog.addEventListener('close', () => {
    stop(); result = null; applyButton.disabled = true;
    returnFocus?.focus({ preventScroll: true });
  }, { signal });
  // Intercept before the game's window listeners, including key releases during preparation/results.
  const keys = new Set(['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Space', 'Enter']);
  window.addEventListener('keydown', event => {
    if (!dialog.open || !keys.has(event.code)) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const editingVolume = document.activeElement === volume;
    if (editingVolume) return;
    // Enter/Space keep their native meaning on action buttons, never reach game input.
    const action = document.activeElement instanceof HTMLButtonElement && document.activeElement !== tapButton;
    if (action && (event.code === 'Space' || event.code === 'Enter')) { event.stopImmediatePropagation(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat && !held.has(event.code)) { held.add(event.code); tap(); }
  }, { capture: true, signal });
  window.addEventListener('keyup', event => {
    if (!dialog.open || !keys.has(event.code)) return;
    held.delete(event.code);
    // Let existing input state release keys that were held before opening the modal.
  }, { capture: true, signal });
  const abortMeasurement = () => {
    if (dialog.open && (measurement || starting)) interrupted('測定を中断しました。画面を開いた状態で、もう一度測定してください。');
  };
  window.addEventListener('blur', abortMeasurement, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) abortMeasurement(); }, { signal });
  return {
    get active() { return dialog.open; },
    open() {
      if (dialog.open) return;
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      stop(); result = null; applyButton.disabled = true;
      tapButton.textContent = '音に合わせてタップ'; progress.value = 0;
      startButton.textContent = '測定を開始'; status.textContent = 'いつも使うスピーカー・イヤホンで測定してください。';
      try { callbacks.pause(); } catch {
        startButton.disabled = true;
        status.textContent = 'MVを一時停止できませんでした。動画を停止してから、もう一度この画面を開いてください。';
      }
      dialog.showModal(); startButton.focus({ preventScroll: true });
    },
    destroy() { stop(); events.abort(); dialog.remove(); },
  };
}
