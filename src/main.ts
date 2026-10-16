import { decoratePenlight } from './penlight';
import { playLane } from './engine';
import './style.css';
import './penlight.css';
import { LANE_COLORS } from './colors';
import { bindDockLayout } from './layout';
import { bindTargets } from './field-geometry';
import { TapSound } from './sound';
import { createCalibrationDialog } from './calibration-dialog';
import { compensateInput } from './timing';
import { generateChart } from './chart';
import { CUSTOM_CHART_KEY, loadChart } from './editor-model';
import { GameEngine } from './engine';
import type { Hit } from './engine';
import { bindInput } from './input';
import { Renderer } from './renderer';
import { loadSettings, normalizeSettings, saveSettings } from './settings';
import { PLAYER_STATE, VideoClock, stateName } from './sync';
import { createYouTubePlayer } from './youtube';
import type { YouTubePlayer } from './youtube';
import { findSong, songStorageKey, songUrl, songVideoUrl } from './songs';
import type { Song } from './songs';
import { publishedChart } from './cloud-published';
import type { CloudChart } from './cloud-schema';
import { bundledChart } from './bundled-charts';
import { bpmAt, tempoLabel } from './tempo';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing UI element: ${id}`);
  return node as T;
}
const song = findSong(new URLSearchParams(location.search).get('song'));
// Invalid links return to selection before creating a player or reading chart data.
if (!song) location.replace('./?missing-song=1');
else void startGame(song).catch(() => {
  element('player-error').hidden = false;
  element('player-error').textContent = '譜面を読み込めませんでした。接続を確認し、ページを再読み込みしてください。';
  element('player-status').textContent = '譜面の読み込みに失敗しました';
  element('stage-hint').querySelector('strong')!.textContent = '譜面を読み込めませんでした';
});
async function startGame(song: Song): Promise<void> {
let online: CloudChart | null = null, previewUid: string | null = null;
if (!__ADMIN__) {
  element('player-status').textContent = '譜面を読み込んでいます…';
  if (new URLSearchParams(location.search).get('preview') === '1') {
    try {
      const { requireCloudAdmin } = await import('./cloud-auth');
      const user = await requireCloudAdmin(), { readDraft } = await import('./cloud-store');
      online = await readDraft(song, user);
      if (!online || !online.chart.notes.length) throw new Error('No preview notes');
      previewUid = user.uid;
    } catch { location.replace(`./admin.html?song=${encodeURIComponent(song.id)}`); return; }
  } else online = await publishedChart(song);
}
const bundled = bundledChart(song);
if (!__ADMIN__ && !online && !bundled) { location.replace('./?unavailable-song=1'); return; }
document.title = `HEY! RHYTHM! — ${song.title}`;
element('song-title').textContent = song.title;
element('song-artist').textContent = `${song.artist} / OFFICIAL MV`;
if (__ADMIN__) element<HTMLAnchorElement>('open-editor').href = songUrl(song, 'editor');
document.querySelector<HTMLAnchorElement>('.playback-info a')!.href = songVideoUrl(song);
let settings = loadSettings(song);
const customChart = __ADMIN__ ? loadChart(songStorageKey(CUSTOM_CHART_KEY, song), true, song) : null;
const requested = new URLSearchParams(location.search).get('chart');
type Source = 'bundled' | 'custom' | 'test';
let source: Source = __ADMIN__ ? requested === 'test' ? 'test' : requested === 'custom' ? customChart ? 'custom' : 'test' : bundled ? 'bundled' : 'test' : 'bundled';
const activeChart = () => !__ADMIN__ ? online?.chart ?? bundled! : source === 'custom' && customChart ? customChart : source === 'bundled' && bundled ? bundled : generateChart(settings.bpm, settings.startTime, song);
if (!__ADMIN__ && requested !== null) {
  const url = new URL(location.href); url.searchParams.delete('chart'); history.replaceState(null, '', url);
}
const engine = new GameEngine(activeChart());
if (previewUid) {
  const back = document.createElement('a'); back.href = `./admin.html?song=${encodeURIComponent(song.id)}`;
  back.className = 'editor-link'; back.textContent = '管理画面'; back.setAttribute('aria-label', '管理画面へ戻る');
  document.querySelector('.header-actions')!.prepend(back);
}
const clock = new VideoClock();
const renderer = new Renderer(element<HTMLCanvasElement>('game-canvas'));
const score = element('score'), combo = element('combo'), maxCombo = element('max-combo');
const judgements = Array.from({ length: 6 }, (_, lane) => element(`judgement-${lane}`));
const judgementTimes = Array<number>(6).fill(-Infinity);
const controlStatus = element('control-status');
const buttons = [...document.querySelectorAll<HTMLButtonElement>('.lane-button')];
buttons.forEach((button, lane) => {
  decoratePenlight(button);
  button.style.setProperty('--lane', LANE_COLORS[lane]);
  button.parentElement!.style.setProperty('--lane', LANE_COLORS[lane]);
});
const unbindTargets = bindTargets(element<HTMLCanvasElement>('game-canvas'), buttons.map(button => button.parentElement!));
const sound = new TapSound(() => { element('sound-status').textContent = 'タップ音を再生できません。端末の音量・ブラウザの音声設定をご確認ください。'; });
sound.enabled = settings.sound;
sound.volume = settings.soundVolume;
sound.delay = settings.soundDelay;
const unbindLayout = bindDockLayout(document.querySelector('.stage')!, document.querySelector('.controls-dock')!);
const result = element('result'), stageHint = element('stage-hint');
const status = element('player-status'), notice = element('game-notice');
const restart = element<HTMLButtonElement>('restart');
const settingsToggle = element<HTMLButtonElement>('settings-toggle');
const settingsPanel = element('settings-panel');
let player: YouTubePlayer | null = null;
let state = -2;
let failed = false;
let videoTime = 0;
let smoothedVideoTime = 0;
let clockStale = false;
let restartTarget: number | null = null;
let restartDeadline = 0;
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
  if (event.pointerType === 'mouse') canvas.focus({ preventScroll: true });
}, { signal });

function updateScore(): void {
  score.textContent = engine.score.toLocaleString('ja-JP');
  combo.textContent = String(engine.combo);
  maxCombo.textContent = `MAX ${engine.maxCombo}`;
}
function syncHoldSound(playing: boolean, now: number): void {
  const lanes = new Set<number>();
  if (playing) for (const note of engine.notes) {
    if (note.state === 'holding' && renderer.pressed.has(playLane(note))) lanes.add(playLane(note));
  }
  sound.syncHolds(lanes, now);
}
function showHit(hit: Hit, now: number): void {
  const feedback = judgements[hit.lane];
  judgementTimes[hit.lane] = now;
  feedback.hidden = false;
  feedback.dataset.kind = hit.judgement;
  feedback.querySelector('.judgement-label')!.textContent = hit.boxComplete ? '箱推し成功！' : hit.phase === 'move' ? '推し変！' : hit.phase === 'start' ? 'HOLD' : hit.judgement;
  feedback.querySelector('.judgement-error')!.textContent = hit.judgement === 'MISS' ? '' : `${hit.errorMs >= 0 ? '+' : ''}${hit.errorMs.toFixed(0)} ms`;
  feedback.classList.remove('pop');
  void feedback.offsetWidth;
  feedback.classList.add('pop');
  if (hit.judgement !== 'MISS') renderer.flash(hit.lane, now, hit.judgement);
  updateScore();
}
function clearResults(): void {
  resultShown = false;
  result.hidden = true;
  lastInputError = null;
  judgementTimes.fill(-Infinity);
  judgements.forEach(feedback => { feedback.hidden = true; delete feedback.dataset.kind; });
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
  if (!player || failed) return { time: smoothedVideoTime - settings.offset / 1000, playing: false };
  try {
    // Also poll state: input cannot score during a state-event delivery delay.
    const observed = player.getPlayerState();
    if (observed !== state) setState(observed);
    const sample = clock.sample(player.getCurrentTime(), state, now, player.getPlaybackRate());
    videoTime = sample.rawTime;
    smoothedVideoTime = sample.time;
    const wasStale = clockStale;
    clockStale = sample.stale;
    if (clockStale !== wasStale) { if (clockStale) sound.cancelPending(); setState(state); }
    const gameTime = sample.time - settings.offset / 1000;
    if (restartTarget !== null) {
      // seekTo is asynchronous; never process the old playhead during a restart.
      if (Math.abs(videoTime - restartTarget) <= 0.5) { restartTarget = null; clock.reset(); }
      else if (now > restartDeadline) {
        restartTarget = null;
        engine.seek(compensateInput(gameTime, settings.inputOffset), true);
        clearResults();
        notice.textContent = '指定位置へのシークが完了しませんでした。動画を確認して、もう一度リスタートしてください。';
      } else return { time: gameTime, playing: false };
    }
    if (sample.seek) {
      sound.cancelPending();
      engine.seek(compensateInput(gameTime, settings.inputOffset), sample.backwards);
      clearResults();
      notice.textContent = sample.backwards ? '後方シーク：スコアをリセットしました。' : '前方シーク・時刻の再同期：飛ばしたノーツはMISSに数えません。';
    }
    return { time: gameTime, playing: sample.playing && !calibration.active };
  } catch {
    showError('プレーヤーの再生時刻を取得できません。ページを再読み込みしてください。');
    return { time: smoothedVideoTime - settings.offset / 1000, playing: false };
  }
}
function setState(next: number): void {
  sound.setPlaybackActive(next === PLAYER_STATE.PLAYING && !clockStale);
  if (next !== state && next === PLAYER_STATE.PLAYING) void sound.unlock();
  if (next !== state && next !== PLAYER_STATE.PLAYING) sound.cancelPending();
  state = next;
  element('status-dot').classList.toggle('playing', next === PLAYER_STATE.PLAYING && !failed && !clockStale);
  const labels: Record<number, string> = {
    [-2]: 'YouTubeプレーヤーを読み込み中…',
    [-1]: '上のボタンで音を準備して再生',
    [0]: '動画の再生が終了しました',
    [1]: 'MVと同期してプレイ中',
    [2]: '一時停止中 · スコアは保持されます',
    [3]: '動画を読み込み中 · ノーツを停止しています',
    [5]: '上のボタンで音を準備して再生',
  };
  if (!failed) status.textContent = clockStale ? '再生時刻の更新待ち · ノーツを停止中' : labels[next] ?? '上のボタンで音を準備して再生';
  const playStart = element<HTMLButtonElement>('play-start');
  playStart.disabled = failed || next === -2;
  playStart.textContent = next === PLAYER_STATE.PLAYING ? '♫ タップ音を準備' : '▶ 音を準備して再生・再開';
}
function showError(message: string): void {
  sound.setPlaybackActive(false);
  sound.cancelPending();
  failed = true;
  element('player-error').textContent = `${message} 上の「YouTube ↗」から公式動画を開けます。ゲームは停止しています。`;
  element('player-error').hidden = false;
  status.textContent = '動画を再生できないため、ゲームを停止しています';
  element('status-dot').classList.remove('playing');
  restart.disabled = true;
  element<HTMLButtonElement>('play-start').disabled = true;
}
function updateChartInfo(): void {
  element('chart-info').textContent = __ADMIN__ ? `${source === 'custom' ? 'EDITOR CHART' : source === 'bundled' ? 'BUNDLED CHART' : 'TEST CHART'} · ${tempoLabel(engine.chart)} BPM · ${engine.chart.startTime.toFixed(source === 'bundled' ? 2 : 1)}秒〜 · ${engine.notes.length} NOTES` : `${tempoLabel(engine.chart)} BPM · ${engine.notes.length} NOTES`;
}

const disposePlayer = createYouTubePlayer({
  keyboardTarget: canvas,
  ready: instance => {
    player = instance;
    instance.setPlaybackRate(1);
    failed = false;
    element('player-error').hidden = true;
    restart.disabled = false;
    element<HTMLButtonElement>('play-start').disabled = false;
    clock.reset();
    setState(instance.getPlayerState());
  },
  state: next => { if (!failed) setState(next); },
  error: showError,
}, song);

function hit(lane: number): void {
  if (calibration.active) return;
  // Sample timing before audio initialization so a cold AudioContext cannot delay judgement.
  const now = performance.now();
  const sample = readTime(now);
  sound.play(lane);
  if (!sample.playing) return;
  const updates = engine.advance(compensateInput(sample.time, settings.inputOffset), renderer.pressed);
  updates.forEach(update => showHit(update, now));
  const hit = engine.input(lane, compensateInput(sample.time, settings.inputOffset));
  if (hit) { lastInputError = hit.errorMs; showHit(hit, now); }
  syncHoldSound(true, now);
  showResults();
}
const unbindInput = bindInput(buttons, hit, lanes => {
  const previous = renderer.pressed; renderer.pressed = lanes;
  if (calibration.active) return;
  const released = [...previous].filter(lane => !lanes.has(lane));
  const now = performance.now(), sample = readTime(now);
  if (!sample.playing) { syncHoldSound(false, now); return; }
  engine.advance(compensateInput(sample.time, settings.inputOffset), lanes).forEach(result => showHit(result, now));
  released.forEach(lane => engine.release(lane, compensateInput(sample.time, settings.inputOffset)).forEach(result => showHit(result, now)));
  syncHoldSound(true, now);
  showResults();
}, () => calibration.active);

restart.addEventListener('click', () => {
  if (!player || failed) return;
  sound.cancelPending();
  sound.setPlaybackActive(true);
  void sound.unlock();
  engine.reset(activeChart());
  clearResults(); updateChartInfo(); clock.reset();
  restartTarget = 0;
  restartDeadline = performance.now() + 5000;
  notice.textContent = '再生が始まらない場合は、YouTubeプレーヤー内の再生ボタンを押してください。';
  try { player.seekTo(restartTarget, true); player.playVideo(); }
  catch { restartTarget = null; showError('リスタートできませんでした。プレーヤーを再読み込みしてください。'); }
}, { signal });
element('play-start').addEventListener('click', () => {
  if (!player || failed) return;
  sound.setPlaybackActive(true);
  void sound.unlock();
  if (state === PLAYER_STATE.PLAYING) return;
  try { player.playVideo(); }
  catch { sound.setPlaybackActive(false); notice.textContent = 'YouTubeプレーヤー内の再生ボタンを押してください。'; }
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
const soundToggle = element<HTMLInputElement>('sound-toggle');
const soundVolume = element<HTMLInputElement>('sound-volume');
const noteSize = element<HTMLInputElement>('note-size');
const inputOffset = element<HTMLInputElement>('input-offset'), soundDelay = element<HTMLInputElement>('sound-delay');
const bpm = __ADMIN__ ? element<HTMLInputElement>('bpm') : null;
const startTime = __ADMIN__ ? element<HTMLInputElement>('start-time') : null;
const debug = __ADMIN__ ? element<HTMLInputElement>('debug-toggle') : null;
function reflectSettings(): void {
  inputOffset.value = String(settings.inputOffset); soundDelay.value = String(settings.soundDelay);
  element('input-offset-value').textContent = `${settings.inputOffset > 0 ? '+' : ''}${settings.inputOffset} ms`;
  element('sound-delay-value').textContent = `${settings.soundDelay} ms`;
  noteSize.value = String(settings.noteSize);
  element('note-size-value').textContent = `${settings.noteSize}%`;
  travel.value = String(settings.travel); offset.value = String(settings.offset);
  if (bpm) bpm.value = String(settings.bpm);
  if (startTime) startTime.value = String(settings.startTime);
  if (debug) debug.checked = settings.debug;
  soundToggle.checked = settings.sound;
  sound.enabled = settings.sound;
  sound.volume = settings.soundVolume;
  sound.delay = settings.soundDelay;
  element<HTMLButtonElement>('sound-test').disabled = !settings.sound || settings.soundVolume === 0;
  soundVolume.value = String(settings.soundVolume);
  element('sound-volume-value').textContent = `${settings.soundVolume}%`;
  element('travel-value').textContent = `${settings.travel.toFixed(2)}秒`;
  element('offset-value').textContent = `${settings.offset > 0 ? '+' : ''}${settings.offset} ms`;
  if (__ADMIN__) element('debug-panel').hidden = !settings.debug;
}
function changeSettings(): void {
  settings = normalizeSettings({ travel: travel.valueAsNumber, offset: offset.valueAsNumber, bpm: bpm?.valueAsNumber ?? settings.bpm, startTime: startTime?.valueAsNumber ?? settings.startTime, debug: debug?.checked ?? settings.debug, sound: soundToggle.checked, soundVolume: soundVolume.valueAsNumber, noteSize: noteSize.valueAsNumber, inputOffset: inputOffset.valueAsNumber, soundDelay: soundDelay.valueAsNumber });
  reflectSettings();
  if (settings.sound && settings.soundVolume > 0 && state === PLAYER_STATE.PLAYING) void sound.unlock();
  const saved = saveSettings(settings, song);
  element('storage-status').textContent = saved ? '設定を保存しました。' : 'ブラウザへの保存ができません。このページ内では設定を使用できます。';
  if (__ADMIN__ && source === 'test' && (settings.bpm !== engine.chart.bpm || settings.startTime !== engine.chart.startTime)) notice.textContent = 'BPM・開始時刻の変更は「最初からやり直す」で反映されます。';
}
travel.addEventListener('input', changeSettings, { signal });
offset.addEventListener('input', changeSettings, { signal });
bpm?.addEventListener('change', changeSettings, { signal });
startTime?.addEventListener('change', changeSettings, { signal });
debug?.addEventListener('change', changeSettings, { signal });
soundToggle.addEventListener('change', changeSettings, { signal });
soundVolume.addEventListener('input', changeSettings, { signal });
noteSize.addEventListener('input', changeSettings, { signal });
inputOffset.addEventListener('input', changeSettings, { signal });
soundDelay.addEventListener('input', changeSettings, { signal });
const calibration = createCalibrationDialog({
  pause() {
    sound.cancelPending();
    player?.pauseVideo();
  },
  apply(value) { inputOffset.value = String(value); changeSettings(); },
});
element('auto-calibrate').addEventListener('click', () => calibration.open(), { signal });
element('timing-reset').addEventListener('click', () => { inputOffset.value = '0'; soundDelay.value = '0'; changeSettings(); }, { signal });
element('sound-test').addEventListener('click', () => sound.play(0), { signal });
reflectSettings(); updateChartInfo();
if (__ADMIN__) {
  const chartSource = element<HTMLSelectElement>('chart-source');
  chartSource.querySelector<HTMLOptionElement>('option[value="custom"]')!.disabled = !customChart;
  chartSource.querySelector<HTMLOptionElement>('option[value="bundled"]')!.disabled = !bundled;
  function reflectChartSource(): void {
    chartSource.value = source;
    bpm!.disabled = source !== 'test'; startTime!.disabled = source !== 'test';
    element('chart-settings-help').textContent = source === 'test' ? 'BPM・開始時刻は次のリスタートから反映されます。' : source === 'bundled' ? '収録譜面のテンポと時刻を使用します。全体のずれは「ノーツ全体の位置」で調整できます。' : '編集譜面のBPM・時刻は「譜面編集」で変更できます。';
    notice.textContent = source === 'bundled' ? '収録譜面 SMG002 · 動画7.65秒が譜面の先頭です。1.5拍以上のノーツは長推しです。' : source === 'custom' ? '編集譜面を読み込みました。MVを再生して試してください。「譜面編集」から調整して再びゲームで試せます。' : '仮譜面です。実際の楽曲のリズムとは一致しません。';
  }
  reflectChartSource();
  if (!customChart && new URLSearchParams(location.search).get('chart') === 'custom') notice.textContent = '編集譜面を読み込めませんでした。「譜面編集」でノーツを追加し「ゲームで試す」を押してください。仮譜面を表示しています。';
  chartSource.addEventListener('change', () => {
    source = chartSource.value === 'custom' && customChart ? 'custom' : chartSource.value === 'bundled' && bundled ? 'bundled' : 'test';
    const url = new URL(location.href);
    url.searchParams.set('chart', source);
    history.replaceState(null, '', url);
    engine.reset(activeChart()); clearResults(); updateChartInfo(); reflectChartSource();
    if (player && !failed) restart.click();
  }, { signal });
} else notice.textContent = previewUid ? '管理者プレビュー：未公開の下書きで試遊しています。通常のプレイには公開済みの譜面を使います。' : '長推しは終点で離そう。同時推しは片方でもMISSになると、その組は0点です。';

let debugUpdated = 0;
function frame(now: number): void {
  if (disposed) return;
  const sample = readTime(performance.now());
  sound.setPlaybackActive(sample.playing);
  if (sample.playing) {
    const updates = engine.advance(compensateInput(sample.time, settings.inputOffset), renderer.pressed);
    updates.forEach(update => showHit(update, now));
    showResults();
  }
  syncHoldSound(sample.playing, now);
  renderer.draw(engine.notes, sample.time, settings.travel, now, settings.noteSize, bpmAt(engine.chart, sample.time), settings.inputOffset, sample.playing, engine.chart);
  if (failed) {
    stageHint.hidden = false;
    stageHint.querySelector('strong')!.textContent = '動画を再生できません';
    stageHint.querySelector('span:last-child')!.textContent = '上のエラーメッセージをご確認ください';
  } else {
    stageHint.hidden = sample.playing || resultShown;
    const hint = clockStale ? '再生時刻の更新を待っています' : state === PLAYER_STATE.PAUSED ? '一時停止中' : state === PLAYER_STATE.BUFFERING ? '動画を読み込み中…' : state === PLAYER_STATE.ENDED ? 'MVの再生が終了しました' : '上の再生ボタンで開始';
    stageHint.querySelector('strong')!.textContent = hint;
    stageHint.querySelector('span:last-child')!.textContent = 'ハートのバーを同じ色でキャッチ · 二重線の終点で離す';
  }
  judgements.forEach((feedback, lane) => {
    const holding = engine.notes.some(note => playLane(note) === lane && note.state === 'holding');
    buttons[lane].classList.toggle('holding', holding);
    if (holding) {
      feedback.hidden = false;
      if (feedback.querySelector('.judgement-label')!.textContent !== 'HOLD') feedback.querySelector('.judgement-label')!.textContent = 'HOLD';
    } else if (now - judgementTimes[lane] > 800) feedback.hidden = true;
  });
  const guidance = failed ? '動画を再生できません' : clockStale ? '動画時刻の更新待ち' : sample.playing
    ? engine.finished ? 'FINISH! · リザルトをチェック' : sample.time < engine.chart.startTime
      ? `開始まで ${Math.max(0, engine.chart.startTime - sample.time).toFixed(1)}秒` : '上の横線でレスをキャッチ · S D F / J K L'
    : state === PLAYER_STATE.PAUSED ? '一時停止中' : state === PLAYER_STATE.BUFFERING ? '動画を読み込み中…' : 'MVを再生してスタート';
  if (controlStatus.textContent !== guidance) controlStatus.textContent = guidance;
  frames++;
  if (now - fpsStarted >= 500) { fps = frames * 1000 / (now - fpsStarted); frames = 0; fpsStarted = now; }
  if (__ADMIN__ && settings.debug && now - debugUpdated >= 100) {
    debugUpdated = now;
    element('debug-time').textContent = `${videoTime.toFixed(3)} s`;
    element('debug-game-time').textContent = `${(smoothedVideoTime - settings.offset / 1000).toFixed(3)} s`;
    element('debug-clock').textContent = clockStale ? '更新待ち' : sample.playing ? '補間中' : '停止';
    element('debug-state').textContent = failed ? 'ERROR' : stateName(state);
    element('debug-bpm').textContent = String(Math.round(bpmAt(engine.chart, sample.time) * 100) / 100);
    element('debug-offset').textContent = `${settings.offset} ms`;
    element('debug-input-offset').textContent = `${settings.inputOffset} ms`;
    element('debug-input-time').textContent = `${compensateInput(smoothedVideoTime - settings.offset / 1000, settings.inputOffset).toFixed(3)} s`;
    element('debug-sound-delay').textContent = `${settings.soundDelay} ms`;
    element('debug-fps').textContent = (now - previousFrame > 1000 ? 0 : fps).toFixed(0);
    element('debug-error').textContent = lastInputError !== null ? `${lastInputError >= 0 ? '+' : ''}${lastInputError.toFixed(1)} ms` : '—';
    element('debug-judgement').textContent = engine.lastHit?.judgement ?? '—';
  }
  previousFrame = now;
  frameId = requestAnimationFrame(frame);
}
frameId = requestAnimationFrame(frame);
function dispose(): void {
  if (disposed) return;
  disposed = true;
  cancelAnimationFrame(frameId);
  listeners.abort(); unbindInput(); renderer.destroy(); disposePlayer(); sound.destroy(); calibration.destroy(); unbindTargets(); unbindLayout();
}
let stopAccess = () => {};
if (previewUid) {
  const { watchAdminAccess } = await import('./cloud-auth');
  stopAccess = watchAdminAccess(state => {
    if (state.phase === 'checking' && state.user?.uid === previewUid) return;
    if (state.phase !== 'allowed' || state.user?.uid !== previewUid) { dispose(); location.replace('./admin.html'); }
  });
}
if (import.meta.hot) import.meta.hot.dispose(() => { stopAccess(); dispose(); });
}
