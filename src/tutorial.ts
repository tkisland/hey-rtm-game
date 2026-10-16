import { decoratePenlight } from './penlight';
import './tutorial.css';
import './penlight.css';
import { LANE_COLORS } from './colors';
import { bindInput, KEYS } from './input';
import { GameEngine, WINDOWS, playLane } from './engine';
import type { Hit } from './engine';
import { Renderer } from './renderer';
import { bindTargets } from './field-geometry';
import { TapSound } from './sound';
import { loadSettings } from './settings';
import { compensateInput } from './timing';
import { tutorialChart, TUTORIAL_BEAT, TUTORIAL_BPM, TUTORIAL_TRAVEL } from './tutorial-chart';

const steps = [
  {title:'単推し', description:'届くハートのバーが上の横線に重なったら、下の同じ色のペンライトを1回押そう。'},
  {title:'同時推し', description:'線でつながった2つを一緒に押そう。片方でもMISSなら、その組は0点です。'},
  {title:'長推し', description:'ハートの先頭で押し、二重線の終点がラインに来たら離そう。早すぎても遅すぎてもMISSです。'},
  {title:'箱推し', description:'番号順に6色を押そう。6個すべてGOOD以上で「箱推し成功！」。6本を一緒に押す必要はありません。'},
  {title:'DD', description:'虹色のノーツは、どのボタンで押してもOK！ どれか1つをタイミングよく押そう。'},
  {title:'推し変', description:'縦の帯では同じ色を保持。横矢印が上の横線に来たら、指をつけたまま隣へ移ろう。PCは次キーを押すか、先に次を押して矢印で前を離す。二重線で離そう。'},
];

export function mountTutorial(): () => void {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
  const dialog = el<HTMLDialogElement>('tutorial'), opener = el<HTMLButtonElement>('open-tutorial');
  const title = el('tutorial-title'), description = el('tutorial-description'), status = el('tutorial-status');
  const feedback = el('tutorial-feedback'), progress = el<HTMLProgressElement>('tutorial-progress');
  const previous = el<HTMLButtonElement>('tutorial-previous'), next = el<HTMLButtonElement>('tutorial-next');
  const start = el<HTMLButtonElement>('tutorial-start'), audioToggle = el<HTMLInputElement>('tutorial-sound');
  const canvas = el<HTMLCanvasElement>('tutorial-canvas'), pads = el('tutorial-pads');
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
  let settings = loadSettings();
  audioToggle.checked = settings.sound && settings.soundVolume > 0;
  let step = 0, engine = new GameEngine(tutorialChart(0)), phase: 'ready'|'starting'|'playing'|'finished' = 'ready';
  let renderer: Renderer | null = null, sound: TapSound | null = null, beatSound: TapSound | null = null;
  let frame = 0, epoch = 0, began = 0, lastBeat = -1, duration = 0;
  let unbind = () => {}, unbindTargets = () => {}, resize: ResizeObserver | null = null;
  const hitTimes = Array<number>(6).fill(-Infinity);
  const elapsed = (now: number) => (now - began) / 1000;
  function updateScore(): void { el('tutorial-score').textContent = `${engine.score.toLocaleString('ja-JP')} 点 · COMBO ${engine.combo}`; }
  function destroyAudio(): void { sound?.destroy(); beatSound?.destroy(); sound = beatSound = null; }
  function stopRun(): void {
    epoch++; cancelAnimationFrame(frame); frame = 0; phase = 'ready';
    unbind(); unbind = () => {}; destroyAudio();
    if (renderer) renderer.pressed = new Set();
    start.disabled = false;
  }
  function syncHolds(now: number): void {
    const lanes = new Set(engine.notes.filter(note => note.state === 'holding' && renderer?.pressed.has(playLane(note))).map(playLane));
    sound?.syncHolds(lanes, now);
  }
  function showHit(hit: Hit, now: number): void {
    const label = labels[hit.lane]; label.hidden = false; label.textContent = hit.boxComplete ? '箱推し成功！' : hit.phase === 'move' ? '推し変！' : hit.phase === 'start' ? 'HOLD' : hit.judgement;
    label.dataset.kind = hit.judgement; hitTimes[hit.lane] = now;
    if (hit.judgement !== 'MISS') renderer?.flash(hit.lane, now, hit.judgement);
    feedback.textContent = hit.boxComplete ? '箱推し成功！' : hit.phase === 'move' ? '推し変成功！ 終点まで続けよう。' : hit.phase === 'start' ? (engine.notes.find(note => note.id === hit.noteId)?.gimmick === 'slide' ? '矢印が横線に来たら、隣へ持ち替えよう！' : '二重線の終点がラインに重なったら離そう！') : hit.judgement === 'MISS' ? 'MISS · 次のノーツに合わせてみよう。' : `${hit.judgement}！`;
    feedback.classList.toggle('success', hit.judgement !== 'MISS'); updateScore();
  }
  function draw(now: number, time: number): void {
    renderer?.draw(engine.notes, time, TUTORIAL_TRAVEL, now, settings.noteSize, TUTORIAL_BPM, settings.inputOffset, phase === 'playing', engine.chart);
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
    if (beat !== lastBeat) { lastBeat = beat; if (time - beat * TUTORIAL_BEAT < .08) beatSound?.play(0); }
    const hint = time < engine.chart.startTime ? `スタートまで ${Math.ceil((engine.chart.startTime - time) / TUTORIAL_BEAT)} 拍` : 'ラインに合わせてプレイ！';
    if (status.textContent !== hint) status.textContent = hint;
    engine.advance(compensateInput(time, settings.inputOffset), renderer.pressed).forEach(hit => showHit(hit, now));
    syncHolds(now); progress.value = Math.min(1, time / duration); draw(now, time);
    if (time >= duration && engine.finished) {
      phase = 'finished'; frame = 0; unbind(); unbind = () => {}; destroyAudio(); start.disabled = false;
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
    duration = Math.max(...engine.notes.map(note => note.type === 'hold' ? note.endTime : note.time)) + WINDOWS.GOOD + .5;
    el('tutorial-step').textContent = `${step + 1} / ${steps.length}`;
    title.textContent = steps[step].title; description.textContent = steps[step].description;
    feedback.textContent = '「練習をはじめる」で、4拍のカウントからスタート。'; feedback.classList.remove('success');
    status.textContent = `${TUTORIAL_BPM} BPM · 約8秒`; start.textContent = '練習をはじめる';
    previous.disabled = step === 0; next.textContent = step === steps.length - 1 ? '選曲に戻る' : '次へ';
    progress.value = 0; labels.forEach(label => { label.hidden = true; }); hitTimes.fill(-Infinity);
    el('tutorial-audio-status').textContent = '';
    renderer?.clearEffects(); updateScore(); draw(performance.now(), 0);
    dialog.scrollTop = 0;
  }
  async function play(): Promise<void> {
    showStep(); const current = epoch; phase = 'starting'; start.disabled = true; status.textContent = '準備中…';
    const unavailable = () => { if (current === epoch) el('tutorial-audio-status').textContent = '音を再生できません。音なしでも練習できます。'; };
    sound = new TapSound(unavailable); beatSound = new TapSound(unavailable);
    sound.volume = settings.soundVolume || 70; beatSound.volume = Math.min(18, (settings.soundVolume || 70) * .25);
    sound.delay = settings.soundDelay; sound.enabled = beatSound.enabled = audioToggle.checked;
    await Promise.all([sound.unlock(), beatSound.unlock()]);
    if (current !== epoch || !dialog.open) return;
    phase = 'playing'; began = performance.now(); lastBeat = -1; start.textContent = 'もう一度';
    feedback.textContent = 'ノーツがラインに重なるタイミングを狙おう。';
    canvas.scrollIntoView({block:'nearest'});
    sound.setPlaybackActive(true); beatSound.setPlaybackActive(true);
    unbind = bindInput(buttons, lane => {
      if (phase !== 'playing' || !renderer) return;
      const now = performance.now(), time = compensateInput(elapsed(now), settings.inputOffset);
      sound?.play(lane);
      engine.advance(time, renderer.pressed).forEach(hit => showHit(hit, now));
      const hit = engine.input(lane, time); if (hit) showHit(hit, now); syncHolds(now);
    }, lanes => {
      if (phase !== 'playing' || !renderer) return;
      const previous = renderer.pressed; renderer.pressed = lanes;
      const now = performance.now(), time = compensateInput(elapsed(now), settings.inputOffset);
      engine.advance(time, lanes).forEach(hit => showHit(hit, now));
      for (const lane of previous) if (!lanes.has(lane)) engine.release(lane, time).forEach(hit => showHit(hit, now));
      syncHolds(now);
    }, () => phase !== 'playing' || !dialog.open);
    frame = requestAnimationFrame(tick);
  }
  function interrupted(): void {
    if (phase !== 'playing' && phase !== 'starting') return;
    showStep(); feedback.textContent = '練習を中断しました。もう一度、最初から始められます。';
  }
  opener.addEventListener('click', () => {
    if (dialog.open) return;
    settings = loadSettings(); audioToggle.checked = settings.sound && settings.soundVolume > 0;
    step = 0; dialog.showModal(); document.body.classList.add('tutorial-visible');
    renderer = new Renderer(canvas); unbindTargets = bindTargets(canvas, targets); showStep();
    resize = new ResizeObserver(() => { if (phase !== 'playing') draw(performance.now(), phase === 'finished' ? duration : 0); }); resize.observe(canvas);
  }, {signal});
  start.addEventListener('click', () => void play(), {signal});
  audioToggle.addEventListener('change', () => {
    if (!sound || !beatSound) return;
    sound.enabled = beatSound.enabled = audioToggle.checked;
    if (audioToggle.checked) { void sound.unlock(); void beatSound.unlock(); }
  }, {signal});
  function cleanup(): void { stopRun(); resize?.disconnect(); resize = null; unbindTargets(); unbindTargets = () => {}; renderer?.destroy(); renderer = null; document.body.classList.remove('tutorial-visible'); }
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
