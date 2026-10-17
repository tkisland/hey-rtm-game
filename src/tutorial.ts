import { decoratePenlight } from './penlight';
import './tutorial.css';
import './penlight.css';
import { LANE_COLORS } from './colors';
import { bindInput, KEYS } from './input';
import { BOX_SWEEP_SECONDS, BOX_WINDOWS, GameEngine, WINDOWS, playLane } from './engine';
import type { Hit } from './engine';
import { Renderer } from './renderer';
import { bindTargets } from './field-geometry';
import { TapSound } from './sound';
import { loadSettings, normalizePlayerSettings } from './settings';
import { compensateInput } from './timing';
import { tutorialChart, TUTORIAL_BEAT, TUTORIAL_BPM, TUTORIAL_TRAVEL } from './tutorial-chart';

const steps = [
  {title:'単オシ', description:'届くハートのバーが上の横線に重なったら、下の同じ色のペンライトを1回押そう。'},
  {title:'同時オシ', description:'線でつながった2つを一緒に押そう。片方でもMISSなら、その組は0点です。'},
  {title:'長オシ', description:'ハートの先頭で押し、二重線の終点がラインに来たら離そう。早すぎても遅すぎてもMISSです。'},
  {title:'箱オシ', description:'金色の矢印レールが来たら、中央の白・赤に指を2本置き、左はピンク、右は黄色へパッと開こう！ 約0.35秒で左右へなぞると1ノーツ分の得点・コンボ。PCは F＋J → D＋K → S＋L の順に押そう。'},
  {title:'DD', description:'虹色に光る丸いバーがDD！ 「どこでも1タップ」の案内に合わせて、好きなボタンを1つだけタイミングよく押そう。'},
  {title:'オシ変', description:'縦の帯では同じ色を保持。横矢印が上の横線に来たら、指をつけたまま矢印の先の色へ移ろう。離れた色にも移れます。PCは次キーを押すか、先に次を押して矢印で前を離す。二重線で離そう。'},
];

export function mountTutorial(): () => void {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
  const dialog = el<HTMLDialogElement>('tutorial'), opener = el<HTMLButtonElement>('open-tutorial');
  const title = el('tutorial-title'), description = el('tutorial-description'), status = el('tutorial-status');
  const feedback = el('tutorial-feedback'), progress = el<HTMLProgressElement>('tutorial-progress');
  const previous = el<HTMLButtonElement>('tutorial-previous'), next = el<HTMLButtonElement>('tutorial-next');
  const start = el<HTMLButtonElement>('tutorial-start'), audioToggle = el<HTMLInputElement>('tutorial-sound');
  const canvas = el<HTMLCanvasElement>('tutorial-canvas'), pads = el('tutorial-pads');
  const volume = el<HTMLInputElement>('tutorial-volume'), audioStatus = el('tutorial-audio-status');
  const colors = ['ピンク','黄緑','白','赤','紫','黄色'];
  const labels: HTMLOutputElement[] = [], targets: HTMLDivElement[] = [];
  const buttons = LANE_COLORS.map((color, lane) => {
    const target = document.createElement('div'); target.className = 'tutorial-target'; target.style.setProperty('--lane', color);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'tutorial-pad'; button.textContent = KEYS[lane].slice(-1);
    decoratePenlight(button);
    button.setAttribute('aria-label', `${colors[lane]}のボタン（${KEYS[lane].slice(-1)}キー）`);
    const receptor = document.createElement('span'); receptor.className = 'lane-receptor'; receptor.setAttribute('aria-hidden','true');
    const label = document.createElement('output'); label.className = 'tutorial-judgement'; label.hidden = true;
    target.append(receptor, button, label); pads.append(target); targets.push(target); labels.push(label); return button;
  });
  const listeners = new AbortController(), signal = listeners.signal;
  const tutorialSettings = () => __ADMIN__ ? loadSettings() : normalizePlayerSettings(loadSettings());
  let settings = tutorialSettings();
  audioToggle.checked = settings.sound && settings.soundVolume > 0;
  let step = 0, engine = new GameEngine(tutorialChart(0)), phase: 'ready'|'starting'|'playing'|'finished' = 'ready';
  let renderer: Renderer | null = null, sound: TapSound | null = null;
  let frame = 0, epoch = 0, began = 0, lastBeat = -1, duration = 0;
  let unbind = () => {}, unbindTargets = () => {}, resize: ResizeObserver | null = null;
  const hitTimes = Array<number>(6).fill(-Infinity);
  const elapsed = (now: number) => (now - began) / 1000;
  function updateScore(): void { el('tutorial-score').textContent = `${engine.score.toLocaleString('ja-JP')} 点 · COMBO ${engine.combo}`; }
  // Safari supports a playback session for media sound, including when the ringer is muted.
  // Request it only for an explicit sound action, and restore the previous session on exit.
  const audioSession = (navigator as Navigator & {audioSession?: {type:string}}).audioSession;
  let previousSessionType: string | null = null;
  function playbackSession(): void {
    if (!audioSession || previousSessionType !== null) return;
    try { const previous = audioSession.type; audioSession.type = 'playback'; previousSessionType = previous; } catch { /* Optional browser API. */ }
  }
  function releaseSession(): void {
    if (!audioSession || previousSessionType === null) return;
    try { if (audioSession.type === 'playback') audioSession.type = previousSessionType; } catch { /* Optional browser API. */ }
    previousSessionType = null;
  }
  function audioState(message?: string): void {
    el('tutorial-volume-value').textContent = `${volume.value}%`;
    audioStatus.textContent = message ?? (!audioToggle.checked ? '音：OFF' : Number(volume.value) === 0 ? '音：OFF（音量0%）' : `音：ON · ${volume.value}%`);
  }
  function unavailable(): void {
    if (dialog.open && audioToggle.checked && Number(volume.value) > 0) audioState('音を再生できません。「音を確認」で再試行できます。');
  }
  function prepareSound(): TapSound {
    // Keep one output across reference beats, taps and retries, until the dialog closes.
    sound ??= new TapSound(unavailable);
    sound.volume = Number(volume.value); sound.delay = settings.soundDelay; sound.enabled = audioToggle.checked;
    if (sound.enabled && sound.volume > 0) playbackSession(); else releaseSession();
    return sound;
  }
  function stopAudio(): void { sound?.setPlaybackActive(false); sound?.cancelPending(); releaseSession(); }
  function destroyAudio(): void { stopAudio(); sound?.destroy(); sound = null; }
  function stopRun(): void {
    epoch++; cancelAnimationFrame(frame); frame = 0; phase = 'ready';
    unbind(); unbind = () => {}; stopAudio();
    if (renderer) renderer.pressed = new Set();
    start.disabled = false;
  }
  function syncHolds(now: number): void {
    const lanes = new Set(engine.notes.filter(note => note.state === 'holding' && renderer?.pressed.has(playLane(note))).map(playLane));
    sound?.syncHolds(lanes, now);
  }
  function showHit(hit: Hit, now: number): void {
    if (hit.phase === 'sweep') {
      if (hit.judgement !== 'MISS') renderer?.flash(hit.lane, now, hit.judgement);
      feedback.textContent = '2本指で中央から左右の端へ！'; return;
    }
    const feedbackLane = hit.boxComplete ? 2 : hit.lane, label = labels[feedbackLane]; label.hidden = false; label.textContent = hit.boxComplete ? '箱オシ成功！' : hit.phase === 'move' ? 'オシ変！' : hit.phase === 'start' ? 'HOLD' : hit.judgement;
    label.dataset.kind = hit.judgement; hitTimes[feedbackLane] = now;
    if (hit.judgement !== 'MISS') {
      renderer?.flash(hit.lane, now, hit.judgement);
      if (hit.boxComplete && hit.boxId !== undefined) { sound?.playBoxSweep(); renderer?.completeBox(now, hit.boxId); }
    }
    feedback.textContent = hit.boxComplete ? '箱オシ成功！' : hit.phase === 'move' ? 'オシ変成功！ 終点まで続けよう。' : hit.phase === 'start' ? (engine.notes.find(note => note.id === hit.noteId)?.gimmick === 'slide' ? '矢印が横線に来たら、矢印の先の色へ持ち替えよう！' : '二重線の終点がラインに重なったら離そう！') : hit.judgement === 'MISS' ? 'MISS · 次のノーツに合わせてみよう。' : `${hit.judgement}！`;
    feedback.classList.toggle('success', hit.judgement !== 'MISS'); updateScore();
  }
  function draw(now: number, time: number): void {
    renderer?.draw(engine.notes, time, TUTORIAL_TRAVEL, now, { inputOffsetMs: settings.visualOffset, playing: phase === 'playing', chart: engine.chart });
    labels.forEach((label, lane) => {
      const holding = engine.notes.some(note => playLane(note) === lane && note.state === 'holding');
      buttons[lane].classList.toggle('holding', holding);
      if (holding) { label.hidden = false; if (label.textContent !== 'HOLD') label.textContent = 'HOLD'; }
      else if (now - hitTimes[lane] > 750) label.hidden = true;
    });
  }
  function tick(now: number): void {
    if (phase !== 'playing' || !renderer) return;
    const time = elapsed(now), beat = Math.floor(time / TUTORIAL_BEAT);
    // Skip a late reference sound instead of replaying a backlog after a stalled frame.
    if (beat !== lastBeat) { lastBeat = beat; if (time - beat * TUTORIAL_BEAT < .08) sound?.playBeat(); }
    const hint = time < engine.chart.startTime ? `スタートまで ${Math.ceil((engine.chart.startTime - time) / TUTORIAL_BEAT)} 拍` : 'ラインに合わせてプレイ！';
    if (status.textContent !== hint) status.textContent = hint;
    engine.advance(compensateInput(time, settings.inputOffset), renderer.pressed).forEach(hit => showHit(hit, now));
    syncHolds(now); progress.value = Math.min(1, time / duration); draw(now, time);
    if (time >= duration && engine.finished) {
      phase = 'finished'; frame = 0; unbind(); unbind = () => {}; stopAudio(); start.disabled = false;
      renderer.pressed = new Set(); draw(now, time);
      status.textContent = '練習終了'; progress.value = 1;
      const hits = engine.notes.length - engine.counts.MISS;
      feedback.textContent = `${hits} / ${engine.notes.length} ノーツ成功！${hits === engine.notes.length ? 'できました！' : '「もう一度」で再挑戦できます。'}`;
      feedback.classList.toggle('success', hits === engine.notes.length); next.scrollIntoView({block:'nearest'}); return;
    }
    frame = requestAnimationFrame(tick);
  }
  function showStep(): void {
    stopRun(); engine = new GameEngine(tutorialChart(step));
    duration = Math.max(...engine.notes.map(note => (note.type === 'hold' ? note.endTime : note.time) + (note.gimmick === 'box' ? BOX_WINDOWS.GOOD + BOX_SWEEP_SECONDS : WINDOWS.GOOD))) + .5;
    el('tutorial-step').textContent = `${step + 1} / ${steps.length}`;
    title.textContent = steps[step].title; description.textContent = steps[step].description;
    feedback.textContent = '「練習をはじめる」で、4拍のカウントからスタート。'; feedback.classList.remove('success');
    status.textContent = `${TUTORIAL_BPM} BPM · 約${Math.round(duration)}秒`; start.textContent = '練習をはじめる';
    previous.disabled = step === 0; next.textContent = step === steps.length - 1 ? '選曲に戻る' : '次へ';
    progress.value = 0; labels.forEach(label => { label.hidden = true; }); hitTimes.fill(-Infinity);
    audioState();
    renderer?.clearEffects(); updateScore(); draw(performance.now(), 0);
    dialog.scrollTop = 0;
  }
  async function play(): Promise<void> {
    showStep(); const current = epoch; phase = 'starting'; start.disabled = true; status.textContent = '準備中…';
    const audio = prepareSound(), ready = await audio.unlock();
    if (current !== epoch || !dialog.open) return;
    if (!ready) unavailable(); else audioState();
    phase = 'playing'; began = performance.now(); lastBeat = -1; start.textContent = 'もう一度';
    feedback.textContent = 'ノーツがラインに重なるタイミングを狙おう。';
    canvas.scrollIntoView({block:'nearest'});
    audio.setPlaybackActive(true);
    unbind = bindInput(buttons, (lane, gesture) => {
      if (phase !== 'playing' || !renderer) return;
      const now = performance.now(), time = compensateInput(elapsed(now), settings.inputOffset);
      if (!gesture?.sweepOnly) sound?.play(lane);
      engine.advance(time, renderer.pressed).forEach(hit => showHit(hit, now));
      const hit = engine.input(lane, time, gesture); if (hit) showHit(hit, now); syncHolds(now);
    }, lanes => {
      if (phase !== 'playing' || !renderer) return;
      const previous = renderer.pressed; renderer.pressed = lanes;
      const now = performance.now(), time = compensateInput(elapsed(now), settings.inputOffset);
      engine.advance(time, lanes).forEach(hit => showHit(hit, now));
      for (const lane of previous) if (!lanes.has(lane)) engine.release(lane, time).forEach(hit => showHit(hit, now));
      syncHolds(now);
    }, () => phase !== 'playing' || !dialog.open, {sweepCrossings:true, onGestureEnd:id => engine.cancelBoxGesture(id), slideDestination:lane => engine.nextSlideLane(lane)});
    frame = requestAnimationFrame(tick);
  }
  function interrupted(): void {
    if (phase !== 'playing' && phase !== 'starting') return;
    showStep(); feedback.textContent = '練習を中断しました。もう一度、最初から始められます。';
  }
  opener.addEventListener('click', () => {
    if (dialog.open) return;
    settings = tutorialSettings(); audioToggle.checked = settings.sound && settings.soundVolume > 0;
    volume.value = String(settings.soundVolume || 70);
    step = 0; dialog.showModal(); document.body.classList.add('tutorial-visible');
    renderer = new Renderer(canvas); unbindTargets = bindTargets(canvas, targets); showStep();
    resize = new ResizeObserver(() => { if (phase !== 'playing') draw(performance.now(), phase === 'finished' ? duration : 0); }); resize.observe(canvas);
  }, {signal});
  start.addEventListener('click', () => void play(), {signal});
  audioToggle.addEventListener('change', () => {
    if (audioToggle.checked && Number(volume.value) === 0) volume.value = '70';
    audioState();
    if (!sound) return;
    const audio = prepareSound(), current = epoch;
    if (audioToggle.checked) void audio.unlock().then(ready => { if (current === epoch && dialog.open && !ready) unavailable(); });
  }, {signal});
  volume.addEventListener('input', () => {
    audioState(); if (!sound) return;
    const audio = prepareSound(), current = epoch;
    if (audio.enabled && audio.volume) void audio.unlock().then(ready => { if (current === epoch && dialog.open && !ready) unavailable(); });
  }, {signal});
  el('tutorial-sound-test').addEventListener('click', () => {
    audioToggle.checked = true; if (Number(volume.value) === 0) volume.value = '70';
    audioState('音を準備中…'); const audio = prepareSound(), current = epoch;
    void audio.unlock().then(ready => {
      if (current !== epoch || !dialog.open) return;
      if (!audio.enabled || !audio.volume) { audioState(); return; }
      if (ready) { audio.playBeat(); audioState('確認音を再生しました。'); } else unavailable();
    });
  }, {signal});
  function cleanup(): void { stopRun(); destroyAudio(); resize?.disconnect(); resize = null; unbindTargets(); unbindTargets = () => {}; renderer?.destroy(); renderer = null; document.body.classList.remove('tutorial-visible'); }
  function closeTutorial(): void { cleanup(); dialog.close(); }
  el('tutorial-close').addEventListener('click', closeTutorial, {signal});
  dialog.addEventListener('cancel', cleanup, {signal});
  dialog.addEventListener('close', () => { if (!dialog.open) { cleanup(); opener.focus({preventScroll:true}); } }, {signal});
  previous.addEventListener('click', () => { if (step > 0) { step--; showStep(); title.focus(); } }, {signal});
  next.addEventListener('click', () => { if (step === steps.length - 1) closeTutorial(); else { step++; showStep(); title.focus(); } }, {signal});
  window.addEventListener('blur', interrupted, {signal});
  document.addEventListener('visibilitychange', () => { if (document.hidden) interrupted(); }, {signal});
  return () => { cleanup(); listeners.abort(); dialog.close(); pads.replaceChildren(); };
}
