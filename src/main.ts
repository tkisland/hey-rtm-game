import './style.css';
import { generateChart } from './chart';
import { GameEngine } from './engine';
import type { Hit } from './engine';
import { bindInput } from './input';
import { Renderer } from './renderer';
import { loadSettings, normalizeSettings, saveSettings } from './settings';
import { PLAYER_STATE, VideoClock, stateName } from './sync';
import { createYouTubePlayer } from './youtube';
import type { YouTubePlayer } from './youtube';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing UI element: ${id}`);
  return node as T;
}
let settings = loadSettings();
const engine = new GameEngine(generateChart(settings.bpm, settings.startTime));
const clock = new VideoClock();
const renderer = new Renderer(element<HTMLCanvasElement>('game-canvas'));
const score = element('score'), combo = element('combo'), maxCombo = element('max-combo');
const judgement = element('judgement'), judgementDetail = element('judgement-detail');
const result = element('result'), stageHint = element('stage-hint');
const status = element('player-status'), notice = element('game-notice');
const restart = element<HTMLButtonElement>('restart');
const settingsToggle = element<HTMLButtonElement>('settings-toggle');
const settingsPanel = element('settings-panel');
let player: YouTubePlayer | null = null;
let state = -2;
let failed = false;
let videoTime = 0;
let restartTarget: number | null = null;
let restartDeadline = 0;
let judgementAt = -Infinity;
let lastInputError: number | null = null;
let resultShown = false;
let disposed = false;
let frameId = 0;
let previousFrame = performance.now(), fpsStarted = previousFrame, frames = 0, fps = 0;
const listeners = new AbortController();
const signal = listeners.signal;
// A click in the game returns keyboard focus from the cross-origin video iframe.
const canvas = element<HTMLCanvasElement>('game-canvas');
canvas.addEventListener('pointerdown', event => {
  event.preventDefault();
  canvas.focus({ preventScroll: true });
}, { signal });

function updateScore(): void {
  score.textContent = engine.score.toString().padStart(6, '0');
  combo.textContent = String(engine.combo);
  maxCombo.textContent = `MAX ${engine.maxCombo}`;
}
function showHit(hit: Hit, now: number): void {
  judgementAt = now;
  judgement.textContent = hit.judgement;
  judgement.dataset.kind = hit.judgement;
  judgementDetail.textContent = hit.judgement === 'MISS' ? '次のノーツを狙おう！' : `${hit.errorMs >= 0 ? '+' : ''}${hit.errorMs.toFixed(0)} ms`;
  judgement.classList.remove('pop');
  // Restart the small CSS animation without registering additional listeners.
  void judgement.offsetWidth;
  judgement.classList.add('pop');
  if (hit.judgement !== 'MISS') renderer.flash(hit.lane, now);
  updateScore();
}
function clearResults(): void {
  resultShown = false;
  result.hidden = true;
  judgementAt = -Infinity;
  lastInputError = null;
  judgement.textContent = 'READY';
  delete judgement.dataset.kind;
  judgementDetail.textContent = 'MVを再生してスタート';
  renderer.clearEffects();
  updateScore();
}
function showResults(): void {
  if (resultShown || !engine.finished) return;
  resultShown = true;
  result.hidden = false;
  element('result-score').textContent = engine.score.toLocaleString('ja-JP');
  element('result-combo').textContent = `MAX COMBO ${engine.maxCombo}`;
  const counts = element('result-counts');
  counts.replaceChildren();
  for (const [name, count] of Object.entries(engine.counts)) {
    const item = document.createElement('div');
    const label = document.createElement('span'), value = document.createElement('strong');
    label.textContent = name; value.textContent = String(count);
    item.append(label, value); counts.append(item);
  }
  element('result-accuracy').textContent = `得点率 ${engine.accuracy.toFixed(1)}%（判定済みノーツのみ） · シークでスキップ ${engine.skipped} / 全 ${engine.notes.length} ノーツ`;
}
function readTime(now: number): { time: number; playing: boolean } {
  if (!player || failed) return { time: videoTime - settings.offset / 1000, playing: false };
  try {
    // Also poll state: input cannot score during a state-event delivery delay.
    const observed = player.getPlayerState();
    if (observed !== state) setState(observed);
    const sample = clock.sample(player.getCurrentTime(), state, now);
    videoTime = sample.time;
    const gameTime = videoTime - settings.offset / 1000;
    if (restartTarget !== null) {
      // seekTo is asynchronous; never process the old playhead during a restart.
      if (Math.abs(videoTime - restartTarget) <= 0.5) { restartTarget = null; clock.reset(); }
      else if (now > restartDeadline) {
        restartTarget = null;
        engine.seek(gameTime, true);
        clearResults();
        notice.textContent = '指定位置へのシークが完了しませんでした。動画を確認して、もう一度リスタートしてください。';
      } else return { time: gameTime, playing: false };
    }
    if (sample.seek) {
      engine.seek(gameTime, sample.backwards);
      clearResults();
      notice.textContent = sample.backwards ? '後方シーク：スコアをリセットしました。' : '前方シーク：飛ばしたノーツはMISSに数えません。';
    }
    return { time: gameTime, playing: sample.playing };
  } catch {
    showError('プレーヤーの再生時刻を取得できません。ページを再読み込みしてください。');
    return { time: videoTime, playing: false };
  }
}
function setState(next: number): void {
  state = next;
  element('status-dot').classList.toggle('playing', next === PLAYER_STATE.PLAYING && !failed);
  const labels: Record<number, string> = {
    [-2]: 'YouTubeプレーヤーを読み込み中…',
    [-1]: 'MVの再生ボタンを押してスタート',
    [0]: '動画の再生が終了しました',
    [1]: 'MVと同期してプレイ中',
    [2]: '一時停止中 · スコアは保持されます',
    [3]: '動画を読み込み中 · ノーツを停止しています',
    [5]: 'MVの再生ボタンを押してスタート',
  };
  if (!failed) status.textContent = labels[next] ?? 'MVの再生ボタンを押してスタート';
}
function showError(message: string): void {
  failed = true;
  element('player-error').textContent = `${message} 上の「YouTube ↗」から公式動画を開けます。ゲームは停止しています。`;
  element('player-error').hidden = false;
  status.textContent = '動画を再生できないため、ゲームを停止しています';
  element('status-dot').classList.remove('playing');
  restart.disabled = true;
}
function updateChartInfo(): void {
  element('chart-info').textContent = `TEST CHART · ${engine.chart.bpm} BPM · ${engine.chart.startTime.toFixed(1)}秒〜 · ${engine.notes.length} NOTES`;
}

const disposePlayer = createYouTubePlayer({
  ready: instance => {
    player = instance;
    failed = false;
    element('player-error').hidden = true;
    restart.disabled = false;
    clock.reset();
    setState(instance.getPlayerState());
  },
  state: next => { if (!failed) setState(next); },
  error: showError,
});

function hit(lane: number): void {
  const now = performance.now();
  const sample = readTime(now);
  if (!sample.playing) return;
  const misses = engine.advance(sample.time);
  if (misses.length) showHit(misses[misses.length - 1], now);
  const hit = engine.input(lane, sample.time);
  if (hit) { lastInputError = hit.errorMs; showHit(hit, now); }
  showResults();
}
const unbindInput = bindInput([...document.querySelectorAll<HTMLButtonElement>('.lane-button')], hit, lanes => { renderer.pressed = lanes; });

restart.addEventListener('click', () => {
  if (!player || failed) return;
  engine.reset(generateChart(settings.bpm, settings.startTime));
  clearResults(); updateChartInfo(); clock.reset();
  restartTarget = Math.max(0, settings.startTime - settings.travel - 0.5);
  restartDeadline = performance.now() + 5000;
  notice.textContent = '再生が始まらない場合は、YouTubeプレーヤー内の再生ボタンを押してください。';
  try { player.seekTo(restartTarget, true); player.playVideo(); }
  catch { restartTarget = null; showError('リスタートできませんでした。プレーヤーを再読み込みしてください。'); }
}, { signal });

function showSettings(open: boolean): void {
  settingsPanel.hidden = !open;
  settingsToggle.setAttribute('aria-expanded', String(open));
  if (open) element<HTMLInputElement>('travel').focus({ preventScroll: true });
  else settingsToggle.focus({ preventScroll: true });
}
settingsToggle.addEventListener('click', () => showSettings(settingsPanel.hidden), { signal });
element('settings-close').addEventListener('click', () => showSettings(false), { signal });
const travel = element<HTMLInputElement>('travel'), offset = element<HTMLInputElement>('offset');
const bpm = element<HTMLInputElement>('bpm'), startTime = element<HTMLInputElement>('start-time'), debug = element<HTMLInputElement>('debug-toggle');
function reflectSettings(): void {
  travel.value = String(settings.travel); offset.value = String(settings.offset);
  bpm.value = String(settings.bpm); startTime.value = String(settings.startTime); debug.checked = settings.debug;
  element('travel-value').textContent = `${settings.travel.toFixed(2)}秒`;
  element('offset-value').textContent = `${settings.offset > 0 ? '+' : ''}${settings.offset} ms`;
  element('debug-panel').hidden = !settings.debug;
}
function changeSettings(): void {
  settings = normalizeSettings({ travel: travel.valueAsNumber, offset: offset.valueAsNumber, bpm: bpm.valueAsNumber, startTime: startTime.valueAsNumber, debug: debug.checked });
  reflectSettings();
  const saved = saveSettings(settings);
  element('storage-status').textContent = saved ? '設定を保存しました。' : 'ブラウザへの保存ができません。このページ内では設定を使用できます。';
  if (settings.bpm !== engine.chart.bpm || settings.startTime !== engine.chart.startTime) notice.textContent = 'BPM・開始時刻の変更は「最初からやり直す」で反映されます。';
}
travel.addEventListener('input', changeSettings, { signal });
offset.addEventListener('input', changeSettings, { signal });
bpm.addEventListener('change', changeSettings, { signal });
startTime.addEventListener('change', changeSettings, { signal });
debug.addEventListener('change', changeSettings, { signal });
reflectSettings(); updateChartInfo();

let debugUpdated = 0;
function frame(now: number): void {
  if (disposed) return;
  const sample = readTime(now);
  if (sample.playing) {
    const misses = engine.advance(sample.time);
    if (misses.length) showHit(misses[misses.length - 1], now);
    showResults();
  }
  renderer.draw(engine.notes, sample.time, settings.travel, now);
  if (failed) {
    stageHint.hidden = false;
    stageHint.querySelector('strong')!.textContent = '動画を再生できません';
    stageHint.querySelector('span:last-child')!.textContent = '上のエラーメッセージをご確認ください';
  } else {
    stageHint.hidden = sample.playing || resultShown;
    const hint = state === PLAYER_STATE.PAUSED ? '一時停止中' : state === PLAYER_STATE.BUFFERING ? '動画を読み込み中…' : state === PLAYER_STATE.ENDED ? 'MVの再生が終了しました' : 'MVの再生ボタンで開始';
    stageHint.querySelector('strong')!.textContent = hint;
    stageHint.querySelector('span:last-child')!.textContent = 'ノーツがラインに重なったらタップ';
  }
  if (sample.playing && now - judgementAt > 800) {
    judgement.textContent = engine.finished ? 'FINISH!' : sample.time < engine.chart.startTime ? 'READY' : 'LET’S GO!';
    delete judgement.dataset.kind;
    judgementDetail.textContent = sample.time < engine.chart.startTime ? `開始まで ${Math.max(0, engine.chart.startTime - sample.time).toFixed(1)}秒` : engine.finished ? 'リザルトをチェック ↓' : 'S D F · J K L';
  }
  frames++;
  if (now - fpsStarted >= 500) { fps = frames * 1000 / (now - fpsStarted); frames = 0; fpsStarted = now; }
  if (settings.debug && now - debugUpdated >= 100) {
    debugUpdated = now;
    element('debug-time').textContent = `${videoTime.toFixed(3)} s`;
    element('debug-state').textContent = failed ? 'ERROR' : stateName(state);
    element('debug-bpm').textContent = String(engine.chart.bpm);
    element('debug-offset').textContent = `${settings.offset} ms`;
    element('debug-fps').textContent = (now - previousFrame > 1000 ? 0 : fps).toFixed(0);
    element('debug-error').textContent = lastInputError !== null ? `${lastInputError >= 0 ? '+' : ''}${lastInputError.toFixed(1)} ms` : '—';
    element('debug-judgement').textContent = engine.lastHit?.judgement ?? '—';
  }
  previousFrame = now;
  frameId = requestAnimationFrame(frame);
}
frameId = requestAnimationFrame(frame);
function dispose(): void {
  disposed = true;
  cancelAnimationFrame(frameId);
  listeners.abort(); unbindInput(); renderer.destroy(); disposePlayer();
}
if (import.meta.hot) import.meta.hot.dispose(dispose);
