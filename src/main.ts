import {resultMessage} from './result-message';
import { decoratePenlight } from './penlight';
import { playLane } from './engine';
import './style.css';
import './penlight.css';
import './concert.css';
import { LANE_COLORS } from './colors';
import { bindDockLayout } from './layout';
import { bindConcertVenue } from './concert-venue';
import { bindTargets } from './field-geometry';
import { TapSound } from './sound';
import { createCalibrationDialog } from './calibration-dialog';
import {updateOnboarding} from './onboarding-state';
import { createSongTimingPreview } from './song-timing-preview';
import { compensateInput } from './timing';
import { generateChart } from './chart';
import { CUSTOM_CHART_KEY, loadChart } from './editor-model';
import { GameEngine } from './engine';
import type { Hit, InputGesture } from './engine';
import { bindInput } from './input';
import { Renderer } from './renderer';
import { loadSettings, normalizePlayerSettings, normalizeSettings, saveSettings } from './settings';
import { PLAYER_STATE, VideoClock, stateName } from './sync';
import { createYouTubePlayer, readYouTubeMetadata } from './youtube';
import type { YouTubePlayer, YouTubeMetadata } from './youtube';
import { findSong, songStorageKey, songUrl, songVideoUrl } from './songs';
import type { Song } from './songs';
import {findDifficulty,difficultyLabel} from './difficulties';
import type {Difficulty} from './difficulties';
import {resultShareUrl} from './result-share';
import {mountResultRanking} from './ranking-result';
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
const difficulty = findDifficulty(new URLSearchParams(location.search).get('difficulty'));
// Invalid links return to selection before creating a player or reading chart data.
if (!song) location.replace('./?missing-song=1');
else if (!difficulty) location.replace('./?missing-difficulty=1');
else void startGame(song,difficulty).catch(() => {
  element('player-error').hidden = false;
  element('player-error').textContent = '譜面を読み込めませんでした。接続を確認し、ページを再読み込みしてください。';
  element('player-status').textContent = '譜面の読み込みに失敗しました';
  element('stage-hint').querySelector('strong')!.textContent = '譜面を読み込めませんでした';
});
async function startGame(song: Song, difficulty:Difficulty): Promise<void> {
let online: CloudChart | null = null, previewUid: string | null = null;
if (!__ADMIN__) {
  element('player-status').textContent = '譜面を読み込んでいます…';
  if (new URLSearchParams(location.search).get('preview') === '1') {
    try {
      const { requireCloudAdmin } = await import('./cloud-auth');
      const user = await requireCloudAdmin(), { readDraft } = await import('./cloud-store');
      online = await readDraft(song, user, difficulty);
      if (!online || !online.chart.notes.length) throw new Error('No preview notes');
      previewUid = user.uid;
    } catch { location.replace(`./admin.html?song=${encodeURIComponent(song.id)}&difficulty=${difficulty}`); return; }
  } else online = await publishedChart(song,difficulty);
}
const bundled = bundledChart(song,difficulty);
if (!__ADMIN__ && !online && !bundled) { location.replace('./?unavailable-song=1'); return; }
document.title = `HEY! RHYTHM! — ${song.title}`;
element('song-title').textContent = song.title;
element('stage-song-title').textContent = `${song.title} · ${difficultyLabel(difficulty)}`;
element('song-difficulty').textContent = difficultyLabel(difficulty);
element('result-difficulty').textContent = difficultyLabel(difficulty);
element('song-artist').textContent = `${song.artist} / OFFICIAL MV`;
if (__ADMIN__) element<HTMLAnchorElement>('open-editor').href = songUrl(song, 'editor',false,difficulty);
document.querySelector<HTMLAnchorElement>('.playback-info a')!.href = songVideoUrl(song);
const normalizeGameSettings = __ADMIN__ ? normalizeSettings : normalizePlayerSettings;
let settings = normalizeGameSettings(loadSettings(song));
const customChart = __ADMIN__ ? loadChart(songStorageKey(CUSTOM_CHART_KEY, song, difficulty), true, song) : null;
const requested = new URLSearchParams(location.search).get('chart');
type Source = 'bundled' | 'custom' | 'test';
let source: Source = __ADMIN__ ? requested === 'test' ? 'test' : requested === 'custom' ? customChart ? 'custom' : 'test' : bundled ? 'bundled' : 'test' : 'bundled';
const activeChart = () => !__ADMIN__ ? online?.chart ?? bundled! : source === 'custom' && customChart ? customChart : source === 'bundled' && bundled ? bundled : generateChart(settings.bpm, settings.startTime, song);
if (!__ADMIN__ && requested !== null) {
  const url = new URL(location.href); url.searchParams.delete('chart'); history.replaceState(null, '', url);
}
const engine = new GameEngine(activeChart());
if (previewUid) {
  const back = document.createElement('a'); back.href = `./admin.html?song=${encodeURIComponent(song.id)}&difficulty=${difficulty}`;
  back.className = 'editor-link'; back.textContent = '管理画面'; back.setAttribute('aria-label', '管理画面へ戻る');
  document.querySelector('.header-actions')!.prepend(back);
}
const clock = new VideoClock();
const diagnostics = new URLSearchParams(location.search).get('sync') === '1'
  ? (await import('./sync-diagnostics')).createSyncDiagnostics(song) : null;
const renderer = new Renderer(element<HTMLCanvasElement>('game-canvas'));
const score = element('score'), combo = element('combo'), maxCombo = element('max-combo');
const judgements = Array.from({ length: 6 }, (_, lane) => element(`judgement-${lane}`));
const judgementLabels = judgements.map(node => node.querySelector<HTMLElement>('.judgement-label')!);
const judgementErrors = judgements.map(node => node.querySelector<HTMLElement>('.judgement-error')!);
const scoreFormat = new Intl.NumberFormat('ja-JP');
const judgementTimes = Array<number>(6).fill(-Infinity);
const controlStatus = element('control-status');
const buttons = [...document.querySelectorAll<HTMLButtonElement>('.lane-button')];
buttons.forEach((button, lane) => {
  decoratePenlight(button);
  button.style.setProperty('--lane', LANE_COLORS[lane]);
  button.parentElement!.style.setProperty('--lane', LANE_COLORS[lane]);
});
const unbindTargets = bindTargets(element<HTMLCanvasElement>('game-canvas'), buttons.map(button => button.parentElement!));
const soundWarning = 'ノーツ音を有効にできません。「ゲームスタート」で再試行してください。';
const sound = new TapSound(() => {
  const warning = soundWarning;
  element('sound-status').textContent = warning;
  if (state === PLAYER_STATE.PLAYING || preparingPlayback || awaitingAudio) element('game-notice').textContent = warning;
}, undefined, () => {
  if (element('sound-status').textContent === soundWarning) element('sound-status').textContent = 'ノーツ音の準備ができました。';
  if (element('game-notice').textContent === soundWarning) element('game-notice').textContent = 'ノーツ音の準備ができました。';
}, Boolean(diagnostics));
sound.enabled = settings.sound;
sound.volume = settings.soundVolume;
sound.delay = settings.soundDelay;
const unbindLayout = bindDockLayout(document.querySelector('.stage')!, document.querySelector('.controls-dock')!);
const unbindVenue = bindConcertVenue(element<HTMLCanvasElement>('game-canvas'), document.querySelector('.media-panel')!, document.querySelector('.live-layout')!);
const result = element('result'), stageHint = element('stage-hint');
const ranking = !__ADMIN__ && !previewUid ? mountResultRanking(song.id,difficulty,online?.json ?? JSON.stringify(bundled!)) : null;
const hintTitle = stageHint.querySelector('strong')!;
const hintDescription = stageHint.querySelector<HTMLElement>('span:last-child')!;
const status = element('player-status'), notice = element('game-notice');
const restart = element<HTMLButtonElement>('restart');
const settingsToggle = element<HTMLButtonElement>('settings-toggle');
const settingsPanel = element('settings-panel');
let player: YouTubePlayer | null = null;
let diagnosticMetadata: YouTubeMetadata | undefined, nextMetadataAt = 0;
let state = -2;
let awaitingAudio = false, preparingPlayback = false, playRequest = 0;
let audioPauseAt = -Infinity;
const audioPrompt = 'ノーツ音の準備が必要です。ゲーム側の「ゲームスタート」を押してライブをはじめてください。';
let failed = false;
let videoTime = 0;
let apiVideoTime = 0, videoRate = 1, predictionRate = 1, diagnosticsSeek = false, diagnosticsResync = false;
let smoothedVideoTime = 0;
let clockStale = false;
let restartTarget: number | null = null;
let restartDeadline = 0;
let restartTimedOut = false;
const restartMessage = () => restartTimedOut ? '先頭からの再生を確認できません。「↻」で再試行してください' : '動画を先頭に戻しています…';
let lastInputError: number | null = null;
let resultShown = false;
let completionAt: number | null = null;
const RESULT_DELAY_MS = 1500;
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

let displayedScore = -1, displayedCombo = -1, displayedMaxCombo = -1;
function updateScore(): void {
  if (displayedScore !== engine.score) { score.textContent = scoreFormat.format(engine.score); displayedScore = engine.score; }
  if (displayedCombo !== engine.combo) { combo.textContent = String(engine.combo); displayedCombo = engine.combo; }
  if (displayedMaxCombo !== engine.maxCombo) { maxCombo.textContent = `MAX ${engine.maxCombo}`; displayedMaxCombo = engine.maxCombo; }
}
function syncHoldSound(playing: boolean, now: number): ReadonlySet<number> {
  const holding = new Set<number>(), audible = new Set<number>();
  for (const note of engine.notes) if (note.state === 'holding') {
    const lane = playLane(note); holding.add(lane);
    if (playing && renderer.pressed.has(lane)) audible.add(lane);
  }
  sound.syncHolds(audible, now);
  return holding;
}
const reducedFeedbackMotion = matchMedia('(prefers-reduced-motion: reduce)');
const feedbackAnimations: (Animation | undefined)[] = Array(6);
function showHit(hit: Hit, now: number): void {
  if (hit.phase === 'sweep') { if (hit.judgement !== 'MISS') renderer.flash(hit.lane, now, hit.judgement); return; }
  const feedbackLane = hit.boxComplete ? 2 : hit.lane, feedback = judgements[feedbackLane];
  judgementTimes[feedbackLane] = now;
  if (feedback.hidden) feedback.hidden = false;
  if (feedback.dataset.kind !== hit.judgement) feedback.dataset.kind = hit.judgement;
  const label = hit.boxComplete ? '箱オシ成功！' : hit.phase === 'move' ? 'オシ変！' : hit.phase === 'start' ? 'HOLD' : hit.judgement;
  const error = hit.judgement === 'MISS' ? '' : `${hit.errorMs >= 0 ? '+' : ''}${hit.errorMs.toFixed(0)} ms`;
  if (judgementLabels[feedbackLane].textContent !== label) judgementLabels[feedbackLane].textContent = label;
  if (judgementErrors[feedbackLane].textContent !== error) judgementErrors[feedbackLane].textContent = error;
  // MISS keeps its label and timeout, without restarting an animation for every passed note.
  if (hit.judgement !== 'MISS' && !reducedFeedbackMotion.matches) {
    const animation = feedbackAnimations[feedbackLane];
    // Six reusable effects avoid allocating/cancelling animations on every tap.
    if (animation) { animation.currentTime = 0; animation.play(); }
    else feedbackAnimations[feedbackLane] = feedback.animate([{scale:'1.08',opacity:.8},{scale:'1',opacity:1}],{duration:180,easing:'ease-out'});
  } else feedbackAnimations[feedbackLane]?.cancel();
  if (hit.judgement !== 'MISS') {
    renderer.flash(hit.lane, now, hit.judgement);
    if (hit.boxComplete && hit.boxId !== undefined) { sound.playBoxSweep(); renderer.completeBox(now, hit.boxId); }
  }
  updateScore();
}
// A stalled frame can settle many notes at once; display only the latest
// feedback per lane instead of updating/restarting the same DOM animation repeatedly.
function showHits(hits: Hit[], now: number): void {
  const latest = new Map<number,Hit>();
  for (const hit of hits) latest.set(hit.boxComplete ? 2 : hit.lane,hit);
  for (const hit of latest.values()) showHit(hit,now);
}
function clearResults(): void {
  resultShown = false;
  completionAt = null;
  result.hidden = true;
  result.querySelectorAll('details').forEach(details=>{details.open=false;});
  ranking?.clear();
  const share = element<HTMLAnchorElement>('result-share');
  share.hidden = true; share.removeAttribute('href');
  element('show-result').hidden = true;
  lastInputError = null;
  judgementTimes.fill(-Infinity);
  judgements.forEach(feedback => { feedback.hidden = true; delete feedback.dataset.kind; });
  feedbackAnimations.forEach(animation => animation?.cancel());
  renderer.clearEffects();
  updateScore();
}
function showResults(): void {
  if (restartTarget !== null || resultShown || !engine.finished) return;
  if (completionAt === null && state !== PLAYER_STATE.PLAYING && state !== PLAYER_STATE.ENDED) return;
  const now = performance.now();
  completionAt ??= now;
  if (now - completionAt < RESULT_DELAY_MS) return;
  resultShown = true;
  result.hidden = false;
  element('show-result').hidden = false;
  element('result-message').textContent = resultMessage(engine.baseScore);
  element('result-score').textContent = scoreFormat.format(engine.score);
  element('result-base-score').textContent = scoreFormat.format(engine.baseScore);
  element('result-combo-bonus').textContent = `＋${scoreFormat.format(engine.comboBonus)}`;
  element('result-special-bonus').textContent = `＋${scoreFormat.format(engine.specialBonus)}`;
  element('result-combo').textContent = `MAX COMBO ${engine.maxCombo}`;
  if (!__ADMIN__ && !previewUid) {
    const share = element<HTMLAnchorElement>('result-share');
    share.href = resultShareUrl(song,difficulty,engine); share.hidden = false;
  }
  const counts = element('result-counts');
  counts.replaceChildren();
  for (const [name, count] of Object.entries(engine.counts)) {
    const item = document.createElement('div');
    const label = document.createElement('span'), value = document.createElement('strong');
    label.textContent = name; value.textContent = String(count);
    item.append(label, value); counts.append(item);
  }
  element('result-accuracy').textContent = `基本スコア得点率 ${engine.accuracy.toFixed(1)}%（判定済みノーツのみ） · 判定済み ${Object.values(engine.counts).reduce((sum,n)=>sum+n,0)} · シークでスキップ ${engine.skipped} / 全 ${engine.notes.length} ノーツ`;
  void ranking?.show({score:engine.score,maxCombo:engine.maxCombo,results:engine.rankingJudgements()},engine.skipped===0 && videoRate===1);
}
function readTime(now: number): { time: number; playing: boolean } {
  if (!player || failed) return { time: smoothedVideoTime - (settings.offset + settings.noteOffset) / 1000, playing: false };
  try {
    // Also poll state: input cannot score during a state-event delivery delay.
    const observed = player.getPlayerState();
    if (observed !== state || observed === PLAYER_STATE.PLAYING && !sound.readyForPlayback) setState(observed);
    apiVideoTime = player.getCurrentTime(); videoRate = player.getPlaybackRate();
    const sample = clock.sample(apiVideoTime, state, now, videoRate);
    predictionRate = sample.predictionRate;
    if (diagnostics && sample.seek) diagnosticsSeek = true;
    if (diagnostics && sample.resync) diagnosticsResync = true;
    videoTime = sample.rawTime;
    smoothedVideoTime = sample.time;
    const wasStale = clockStale;
    clockStale = sample.stale;
    if (clockStale !== wasStale) { if (clockStale) sound.cancelPending(); setState(state); }
    const gameTime = sample.time - (settings.offset + settings.noteOffset) / 1000;
    if (restartTarget !== null) {
      // Time and state arrive independently from the iframe. An old ENDED state
      // must not finish the fresh chart, even if the seek already reports zero.
      if (sample.playing && Math.abs(videoTime - restartTarget) <= 0.5) {
        restartTarget = null; restartTimedOut = false; clock.reset();
        notice.textContent = '最初からライブ開始！';
        return {time:gameTime,playing:!(calibration.active || songTiming.active)};
      }
      if (!restartTimedOut && now > restartDeadline) {
        restartTimedOut = true;
        notice.textContent = restartMessage();
      }
      // A timeout still preserves pending notes; a retry or late seek can recover.
      return {time:gameTime,playing:false};
    }
    // Completed sessions keep their score and result until an explicit restart.
    // YouTube may reset its playhead or deliver a final discontinuity after ENDED.
    if (sample.seek && !engine.finished && state !== PLAYER_STATE.ENDED) {
      ranking?.invalidate('シークしたプレイは登録できません。最初からプレイして記録に挑戦しよう！');
      sound.cancelPending();
      engine.seek(compensateInput(gameTime, settings.inputOffset), sample.backwards);
      clearResults();
      notice.textContent = sample.backwards ? '後方シーク：スコアをリセットしました。' : '前方シーク：飛ばしたノーツはMISSに数えません。';
    }
    if (sample.resync && !engine.finished && state !== PLAYER_STATE.ENDED) {
      notice.textContent = '動画時刻を再同期しました。得点・判定数は保持しています。';
    }
    if(sample.playing && videoRate!==1 && !engine.finished)ranking?.invalidate('再生速度を変更したプレイは登録できません。通常速度でプレイしてください。');
    return { time: gameTime, playing: sample.playing && !(calibration.active || songTiming.active) };
  } catch {
    showError('プレーヤーの再生時刻を取得できません。ページを再読み込みしてください。');
    return { time: smoothedVideoTime - (settings.offset + settings.noteOffset) / 1000, playing: false };
  }
}
function setState(next: number): void {
  if (next === PLAYER_STATE.PLAYING && !sound.readyForPlayback) {
    awaitingAudio = true;
    setState(PLAYER_STATE.PAUSED);
    notice.textContent = audioPrompt;
    if (player && performance.now() - audioPauseAt >= 250) {
      audioPauseAt = performance.now();
      try { player.pauseVideo(); } catch { showError('音声の準備のため動画を一時停止できませんでした。'); }
    }
    return;
  }
  if (next === PLAYER_STATE.PLAYING) {
    if (awaitingAudio && notice.textContent === audioPrompt) notice.textContent = 'ノーツ音の準備ができました。';
    awaitingAudio = false; audioPauseAt = -Infinity;
  }
  if(next!==state)nextMetadataAt=0;
  if (next !== PLAYER_STATE.PLAYING || clockStale) engine.cancelBoxGesture();
  sound.setPlaybackActive(next === PLAYER_STATE.PLAYING && !clockStale);
  if (next !== state && next === PLAYER_STATE.PLAYING) void sound.unlock();
  if (next !== state && next !== PLAYER_STATE.PLAYING) sound.cancelPending();
  state = next;
  element('status-dot').classList.toggle('playing', next === PLAYER_STATE.PLAYING && !failed && !clockStale);
  const labels: Record<number, string> = {
    [-2]: 'YouTubeプレーヤーを読み込み中…',
    [-1]: '「ゲームスタート」を押してライブ開始！',
    [0]: '動画の再生が終了しました',
    [1]: 'MVと同期してプレイ中',
    [2]: '一時停止中 · スコアは保持されます',
    [3]: '動画を読み込み中 · ノーツを停止しています',
    [5]: '「ゲームスタート」を押してライブ開始！',
  };
  if (!failed) status.textContent = awaitingAudio ? 'ノーツ音の準備待ち ·「ゲームスタート」で開始' : clockStale ? '再生時刻の更新待ち · ノーツを停止中' : labels[next] ?? '「ゲームスタート」を押してライブ開始！';
  const playStart = element<HTMLButtonElement>('play-start');
  playStart.disabled = failed || next === -2;
  playStart.textContent = awaitingAudio ? 'ゲームスタート' : next === PLAYER_STATE.PLAYING ? '♫ 音声' : next === PLAYER_STATE.PAUSED ? 'ゲーム再開' : 'ゲームスタート';
  playStart.setAttribute('aria-label', next === PLAYER_STATE.PLAYING ? 'ノーツ音を有効にする' : playStart.textContent!);
}
function showError(message: string): void {
  preparingPlayback = false; playRequest++;
  sound.setPlaybackActive(false);
  sound.cancelPending();
  failed = true;
  element('player-error').textContent = `${message} 楽曲の「詳細」にある「YouTube ↗」から公式動画を開けます。ゲームは停止しています。`;
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

element('result-close').addEventListener('click', () => { result.hidden = true; }, {signal});
element('show-result').addEventListener('click', () => { result.hidden = false; }, {signal});

function hit(lane: number, gesture?: InputGesture): void {
  if (calibration.active || songTiming.active) return;
  // Sample timing before audio initialization so a cold AudioContext cannot delay judgement.
  const now = performance.now();
  const sample = readTime(now);
  if (!gesture?.sweepOnly) sound.play(lane);
  if (!sample.playing) return;
  const updates = engine.advance(compensateInput(sample.time, settings.inputOffset), renderer.pressed);
  showHits(updates,now);
  const hit = engine.input(lane, compensateInput(sample.time, settings.inputOffset), gesture);
  if (hit) { lastInputError = hit.errorMs; showHit(hit, now); }
  syncHoldSound(true, now);
  showResults();
}
const unbindInput = bindInput(buttons, hit, lanes => {
  const previous = renderer.pressed; renderer.pressed = lanes;
  if (calibration.active || songTiming.active) return;
  const released = [...previous].filter(lane => !lanes.has(lane));
  const now = performance.now(), sample = readTime(now);
  if (!sample.playing) { syncHoldSound(false, now); return; }
  showHits(engine.advance(compensateInput(sample.time, settings.inputOffset), lanes),now);
  released.forEach(lane => engine.release(lane, compensateInput(sample.time, settings.inputOffset)).forEach(result => showHit(result, now)));
  syncHoldSound(true, now);
  showResults();
}, () => (calibration.active || songTiming.active), {sweepCrossings:true, onGestureEnd:id => engine.cancelBoxGesture(id), slideDestination:lane => engine.nextSlideLane(lane)});

async function preparePlayback(): Promise<boolean> {
  const request = ++playRequest;
  preparingPlayback = true;
  sound.setPlaybackActive(true);
  const ready = await sound.unlock();
  if (request !== playRequest || disposed || failed) return false;
  preparingPlayback = false;
  if (!ready) { sound.setPlaybackActive(false); notice.textContent = soundWarning; return false; }
  return !(calibration.active || songTiming.active);
}
async function restartGame(): Promise<void> {
  if (!player || failed) return;
  diagnostics?.mark('restart-request');
  sound.cancelPending();
  if (!await preparePlayback()) return;
  engine.reset(activeChart());
  ranking?.restart();
  clearResults(); updateChartInfo(); clock.reset();
  restartTarget = 0;
  restartDeadline = performance.now() + 5000; restartTimedOut = false;
  notice.textContent = restartMessage();
  try { player.seekTo(restartTarget, true); player.playVideo(); }
  catch { restartTarget = null; showError('リスタートできませんでした。プレーヤーを再読み込みしてください。'); }
}
restart.addEventListener('click', restartGame, {signal});
element('result-replay').addEventListener('click', async () => {
  await restartGame();
  if (result.hidden) canvas.focus({preventScroll:true});
}, {signal});
element('play-start').addEventListener('click', async () => {
  if (!player || failed || !await preparePlayback()) return;
  if (state === PLAYER_STATE.PLAYING) return;
  try { player.playVideo(); }
  catch { sound.setPlaybackActive(false); notice.textContent = 'YouTubeプレーヤー内の再生ボタンを押してください。'; }
}, { signal });

function showSettings(open: boolean): void {
  settingsPanel.hidden = !open;
  settingsToggle.setAttribute('aria-expanded', String(open));
  if (open) element<HTMLButtonElement>('song-calibrate').focus({ preventScroll: true });
  else settingsToggle.focus({ preventScroll: true });
}
settingsToggle.addEventListener('click', () => showSettings(settingsPanel.hidden), { signal });
element('settings-close').addEventListener('click', () => showSettings(false), { signal });
const offset = __ADMIN__ ? element<HTMLInputElement>('offset') : null;
const soundToggle = __ADMIN__ ? element<HTMLInputElement>('sound-toggle') : null;
const travel = element<HTMLInputElement>('travel');
const soundVolume = element<HTMLInputElement>('sound-volume');
const inputOffset = __ADMIN__ ? element<HTMLInputElement>('input-offset') : null;
const soundDelay = __ADMIN__ ? element<HTMLInputElement>('sound-delay') : null;
const bpm = __ADMIN__ ? element<HTMLInputElement>('bpm') : null;
const startTime = __ADMIN__ ? element<HTMLInputElement>('start-time') : null;
const debug = __ADMIN__ ? element<HTMLInputElement>('debug-toggle') : null;
function reflectSettings(): void {
  if (__ADMIN__) {
    inputOffset!.value = String(settings.inputOffset); soundDelay!.value = String(settings.soundDelay);
    element('input-offset-value').textContent = `${settings.inputOffset > 0 ? '+' : ''}${settings.inputOffset} ms`;
    element('sound-delay-value').textContent = `${settings.soundDelay} ms`;
    offset!.value = String(settings.offset);
    element('offset-value').textContent = `${settings.offset > 0 ? '+' : ''}${settings.offset} ms`;
    soundToggle!.checked = settings.sound;
    element<HTMLButtonElement>('sound-test').disabled = !settings.sound || settings.soundVolume === 0;
  }
  if (bpm) bpm.value = String(settings.bpm);
  if (startTime) startTime.value = String(settings.startTime);
  if (debug) debug.checked = settings.debug;
  sound.enabled = settings.sound;
  sound.volume = settings.soundVolume;
  sound.delay = settings.soundDelay;
  travel.value = String(settings.travel);
  element('travel-value').textContent = `${settings.travel}秒`;
  soundVolume.value = String(settings.soundVolume);
  element('sound-volume-value').textContent = `${settings.soundVolume}%`;
  if (__ADMIN__) element('debug-panel').hidden = !settings.debug;
}
function changeSettings(): boolean {
  settings = normalizeGameSettings({ ...settings, travel: travel.valueAsNumber, offset: offset?.valueAsNumber ?? settings.offset, bpm: bpm?.valueAsNumber ?? settings.bpm, startTime: startTime?.valueAsNumber ?? settings.startTime, debug: debug?.checked ?? settings.debug, sound: soundToggle?.checked ?? true, soundVolume: soundVolume.valueAsNumber, inputOffset: inputOffset?.valueAsNumber ?? settings.inputOffset, soundDelay: soundDelay?.valueAsNumber ?? settings.soundDelay });
  reflectSettings();
  if (settings.sound && settings.soundVolume > 0 && state === PLAYER_STATE.PLAYING) void sound.unlock();
  const saved = saveSettings(settings, song);
  element('storage-status').textContent = saved ? '設定を保存しました。' : 'ブラウザへの保存ができません。このページ内では設定を使用できます。';
  if (__ADMIN__ && source === 'test' && (settings.bpm !== engine.chart.bpm || settings.startTime !== engine.chart.startTime)) notice.textContent = 'BPM・開始時刻の変更は「最初からやり直す」で反映されます。';
  return saved;
}
offset?.addEventListener('input', changeSettings, { signal });
bpm?.addEventListener('change', changeSettings, { signal });
startTime?.addEventListener('change', changeSettings, { signal });
debug?.addEventListener('change', changeSettings, { signal });
soundToggle?.addEventListener('change', changeSettings, { signal });
travel.addEventListener('input', changeSettings, { signal });
soundVolume.addEventListener('input', changeSettings, { signal });
inputOffset?.addEventListener('input', changeSettings, { signal });
soundDelay?.addEventListener('input', changeSettings, { signal });
const songTiming = createSongTimingPreview({
  settings: () => settings,
  pause() { sound.cancelPending(); player?.pauseVideo(); clock.reset(); },
  apply(noteOffset,checked) { settings = {...settings, noteOffset}; if(changeSettings()&&checked)updateOnboarding({timing:true}); },
});
element('song-calibrate').addEventListener('click', () => songTiming.open(), {signal});
if (new URLSearchParams(location.search).get('timing') === '1') {
  const url = new URL(location.href); url.searchParams.delete('timing'); history.replaceState(null, '', url);
  showSettings(true); songTiming.open();
}
const calibration = createCalibrationDialog({
  settings: () => settings,
  pause() {
    sound.cancelPending();
    player?.pauseVideo();
  },
  apply(value) {
    settings = { ...settings, inputOffset: value };
    if (inputOffset) inputOffset.value = String(value);
    changeSettings();
  },
});
element('flow-calibrate').addEventListener('click', () => calibration.openPreview(), { signal });
if (__ADMIN__) {
  element('auto-calibrate').addEventListener('click', () => calibration.open(), { signal });
  element('timing-reset').addEventListener('click', () => { inputOffset!.value = '0'; soundDelay!.value = '0'; changeSettings(); }, { signal });
  element('sound-test').addEventListener('click', () => sound.play(0), { signal });
}
reflectSettings(); updateChartInfo(); updateScore();
if (__ADMIN__) {
  const chartSource = element<HTMLSelectElement>('chart-source');
  chartSource.querySelector<HTMLOptionElement>('option[value="custom"]')!.disabled = !customChart;
  chartSource.querySelector<HTMLOptionElement>('option[value="bundled"]')!.disabled = !bundled;
  function reflectChartSource(): void {
    chartSource.value = source;
    bpm!.disabled = source !== 'test'; startTime!.disabled = source !== 'test';
    element('chart-settings-help').textContent = source === 'test' ? 'BPM・開始時刻は次のリスタートから反映されます。' : source === 'bundled' ? '収録譜面のテンポと時刻を使用します。全体のずれは「ノーツ全体の位置」で調整できます。' : '編集譜面のBPM・時刻は「譜面編集」で変更できます。';
    notice.textContent = source === 'bundled' ? '収録譜面 SMG005 · 動画7.65秒が譜面の先頭です。1.5拍以上のノーツは長オシです。' : source === 'custom' ? '編集譜面を読み込みました。MVを再生して試してください。「譜面編集」から調整して再びゲームで試せます。' : '仮譜面です。実際の楽曲のリズムとは一致しません。';
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
} else notice.textContent = previewUid ? '管理者プレビュー：未公開の下書きで試遊しています。通常のプレイには公開済みの譜面を使います。' : '長オシは終点で離そう。同時オシは片方でもMISSになると、その組は0点です。';

let debugUpdated = 0;
function frame(now: number): void {
  if (disposed) return;
  // The MV preview owns its own canvas; avoid drawing the hidden game as well.
  if (songTiming.active) { previousFrame = now; frameId = requestAnimationFrame(frame); return; }
  const sample = readTime(performance.now());
  if (!sample.playing) engine.cancelBoxGesture();
  sound.setPlaybackActive(sample.playing || preparingPlayback);
  if (sample.playing) {
    const updates = engine.advance(compensateInput(sample.time, settings.inputOffset), renderer.pressed);
    showHits(updates,now);
  } else if (restartTarget === null && state === PLAYER_STATE.ENDED && !engine.finished) {
    const end = Math.max(sample.time,...engine.notes.map(note => note.type === 'hold' ? note.endTime : note.time));
    // Close any remaining judgement windows when playback has actually ended.
    showHits(engine.advance(end + 1,renderer.pressed),now);
  }
  showResults();
  const holdingLanes = syncHoldSound(sample.playing, now);
  renderer.draw(engine.notes, sample.time, settings.travel, now, { inputOffsetMs: 0, playing: sample.playing, chart: engine.chart });
  if (failed) {
    if (stageHint.hidden) stageHint.hidden = false;
    if (hintTitle.textContent !== '動画を再生できません') hintTitle.textContent = '動画を再生できません';
    if (hintDescription.textContent !== '上のエラーメッセージをご確認ください') hintDescription.textContent = '上のエラーメッセージをご確認ください';
    if (hintDescription.hidden) hintDescription.hidden = false;
  } else {
    const hidden = sample.playing || resultShown;
    if (stageHint.hidden !== hidden) stageHint.hidden = hidden;
    const hint = awaitingAudio ? '「ゲームスタート」を押してライブ開始！' : restartTarget !== null ? restartMessage() : clockStale ? '再生時刻の更新を待っています' : state === PLAYER_STATE.PAUSED ? '「ゲーム再開」を押してライブ再開！' : state === PLAYER_STATE.BUFFERING ? '動画を読み込み中…' : state === PLAYER_STATE.ENDED ? resultMessage(engine.baseScore) : '「ゲームスタート」を押してライブ開始！';
    if (hintTitle.textContent !== hint) hintTitle.textContent = hint;
    if (hintDescription.textContent) hintDescription.textContent = '';
    if (!hintDescription.hidden) hintDescription.hidden = true;
  }
  judgements.forEach((feedback, lane) => {
    const holding = holdingLanes.has(lane);
    buttons[lane].classList.toggle('holding', holding);
    if (holding) {
      if (feedback.hidden) feedback.hidden = false;
      if (judgementLabels[lane].textContent !== 'HOLD') judgementLabels[lane].textContent = 'HOLD';
    } else if (now - judgementTimes[lane] > 800 && !feedback.hidden) feedback.hidden = true;
  });
  const guidance = failed ? '動画を再生できません' : awaitingAudio ? 'ノーツ音の準備待ち · 上の「ゲームスタート」で開始' : restartTarget !== null ? restartMessage() : clockStale ? '動画時刻の更新待ち' : sample.playing
    ? engine.finished ? 'FINISH! · リザルトをチェック' : sample.time < engine.chart.startTime
      ? `開始まで ${Math.max(0, engine.chart.startTime - sample.time).toFixed(1)}秒` : '上の横線でレスをキャッチ · S D F / J K L'
    : state === PLAYER_STATE.PAUSED ? '「ゲーム再開」を押してライブ再開！' : state === PLAYER_STATE.BUFFERING ? '動画を読み込み中…' : '上の「ゲームスタート」でライブ開始！';
  if (controlStatus.textContent !== guidance) controlStatus.textContent = guidance;
  frames++;
  if (now - fpsStarted >= 500) { fps = frames * 1000 / (now - fpsStarted); frames = 0; fpsStarted = now; }
  if(diagnostics&&player&&now>=nextMetadataAt){diagnosticMetadata=readYouTubeMetadata(player);nextMetadataAt=now+250;}
  diagnostics?.record({ audio:sound.diagnostics(), ...diagnosticMetadata, atMs:performance.now(), apiTime:apiVideoTime, clockTime:smoothedVideoTime,
    judgementTime:compensateInput(sample.time,settings.inputOffset), playerState:state, reportedRate:videoRate, predictionRate,
    playing:sample.playing, stale:clockStale, seek:diagnosticsSeek, resync:diagnosticsResync,
    score:engine.score, judgedNotes:Object.values(engine.counts).reduce((sum,n)=>sum+n,0), skippedNotes:engine.skipped, totalNotes:engine.notes.length, inputOffsetMs:settings.inputOffset,
    chartOffsetMs:settings.offset, noteOffsetMs:settings.noteOffset, inputErrorMs:lastInputError, frameGapMs:Math.max(0,now-previousFrame), fps });
  diagnosticsSeek = false; diagnosticsResync = false;
  if (__ADMIN__ && settings.debug && now - debugUpdated >= 100) {
    debugUpdated = now;
    element('debug-time').textContent = `${videoTime.toFixed(3)} s`;
    element('debug-game-time').textContent = `${(smoothedVideoTime - (settings.offset + settings.noteOffset) / 1000).toFixed(3)} s`;
    element('debug-clock').textContent = clockStale ? '更新待ち' : sample.playing ? '補間中' : '停止';
    element('debug-state').textContent = failed ? 'ERROR' : stateName(state);
    element('debug-bpm').textContent = String(Math.round(bpmAt(engine.chart, sample.time) * 100) / 100);
    element('debug-offset').textContent = `${settings.offset} ms`;
    element('debug-input-offset').textContent = `${settings.inputOffset} ms`;
    element('debug-input-time').textContent = `${compensateInput(smoothedVideoTime - (settings.offset + settings.noteOffset) / 1000, settings.inputOffset).toFixed(3)} s`;
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
  disposed = true; playRequest++;
  cancelAnimationFrame(frameId);
  feedbackAnimations.forEach(animation => animation?.cancel());
  listeners.abort(); ranking?.destroy(); unbindInput(); renderer.destroy(); disposePlayer(); sound.destroy(); calibration.destroy(); songTiming.destroy(); diagnostics?.destroy(); unbindTargets(); unbindVenue(); unbindLayout();
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
