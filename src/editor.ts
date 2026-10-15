import './style.css';
import './editor.css';
import { LANE_COLORS } from './colors';
import { CUSTOM_CHART_KEY, EDITOR_KEY, EditorModel, MAX_TIME, MIN_HOLD, emptyChart, inRange, loadChart, parseChart, storeChart, validateRange } from './editor-model';
import type { Division, NoteClipboard, TimeRange } from './editor-model';
import { bindInput } from './input';
import { loadSettings, normalizeSettings, saveSettings } from './settings';
import { TapSound } from './sound';
import { createCalibrationDialog } from './calibration-dialog';
import { compensateInput } from './timing';
import { VideoClock } from './sync';
import { Timeline } from './timeline';
import { Renderer } from './renderer';
import { bindTargets } from './field-geometry';
import { EditorPreview, previewStart } from './editor-preview';
import { createYouTubePlayer } from './youtube';
import type { YouTubePlayer } from './youtube';
import { findSong, songStorageKey, songUrl, songVideoUrl } from './songs';
import { bundledChart } from './bundled-charts';
import { beatToTime, bpmAt, tempoLabel, timeToBeat } from './tempo';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id); if (!node) throw new Error(`Missing editor element: ${id}`);
  return node as T;
}
const input = (id: string) => el<HTMLInputElement>(id);
const select = (id: string) => el<HTMLSelectElement>(id);
const song = findSong(new URLSearchParams(location.search).get('song'));
if (!song) location.replace('./?missing-song=1');
else {
const editorKey = songStorageKey(EDITOR_KEY, song), customKey = songStorageKey(CUSTOM_CHART_KEY, song);
document.title = `譜面エディター — ${song.title}`;
el('editor-song-title').textContent = `${song.title} / CHART EDITOR`;
el<HTMLAnchorElement>('back-to-game').href = songUrl(song, 'game');
document.querySelector<HTMLAnchorElement>('.playback-info a')!.href = songVideoUrl(song);
const model = new EditorModel(loadChart(editorKey, false, song) ?? emptyChart(song));
const bundled = bundledChart(song);
const clock = new VideoClock();
const sound = new TapSound(() => message('確認音を再生できません。端末の音量・ブラウザの音声設定をご確認ください。'));
let settings = loadSettings(); sound.volume = settings.soundVolume; sound.delay = settings.soundDelay;
input('editor-sound').checked = settings.sound;
const listeners = new AbortController(), signal = listeners.signal;
input('editor-sound').addEventListener('change', () => {
  sound.setPlaybackActive(playing && !previewing && input('editor-sound').checked);
  if (!input('editor-sound').checked) sound.cancelPending();
  else if (playing && !previewing) void sound.unlock();
}, { signal });
let player: YouTubePlayer | null = null;
let failed = false, armed = false, disposed = false, time = 0, playing = false;
let viewStart = Math.max(0, model.chart.startTime - 1), viewSpan = 4, saveTimer = 0, frameId = 0, lastUi = 0, lastAudition: number | null = null;
const captures = new Map<number, number>();
let pressed = new Set<number>();
let seekTarget: number | null = null, seekDeadline = 0;
let selectedRange: TimeRange | null = null, clipboard: NoteClipboard | null = null;
let playbackRate = 1, rateRequest: { rate: number; deadline: number } | null = null;
const division = (): Division => Number(select('division').value) as Division;
const message = (text: string) => { el('editor-notice').textContent = text; };
const preview = new EditorPreview(); preview.sync(model.chart);
const previewRenderer = new Renderer(el<HTMLCanvasElement>('preview-canvas'));
const previewSound = new TapSound(() => { el('preview-audio-status').textContent = 'ノーツ音を再生できません。端末の音量・ブラウザの音声設定をご確認ください。映像のプレビューは続けられます。'; });
previewSound.volume = settings.soundVolume; // Reference chart sounds have no input compensation or added tap delay.
input('preview-volume').value = String(settings.soundVolume);
el('preview-volume-value').textContent = `${settings.soundVolume}%`;
let previewing = false, previewEndMessage = '';
let previewTarget: { time: number; includeExact: boolean } | null = null;
const previewLanes = [...el('preview-lanes').querySelectorAll<HTMLElement>('[data-lane]')];
const unbindPreviewTargets = bindTargets(el<HTMLCanvasElement>('preview-canvas'), previewLanes);
const previewFeedback = Array<number>(6).fill(-Infinity), previewLabels = Array<string>(6).fill('—');
previewLanes.forEach((lane, i) => lane.style.setProperty('--lane', LANE_COLORS[i]));
function clearPreviewEffects(): void {
  previewFeedback.fill(-Infinity); previewLabels.fill('—');
  previewRenderer.clearEffects(); previewRenderer.pressed.clear();
}
function refreshPreviewControls(): void {
  const available = player !== null && !failed && model.chart.notes.length > 0;
  for (const id of ['preview-play', 'preview-first']) el<HTMLButtonElement>(id).disabled = !available;
  el<HTMLButtonElement>('preview-selected').disabled = !available || !model.selectedNote;
  el<HTMLButtonElement>('preview-pause').disabled = !previewing || !playing;
  el<HTMLButtonElement>('preview-stop').disabled = !previewing;
}
function stopPreview(pause = true): void {
  previewSound.setPlaybackActive(false);
  const active = previewing;
  previewing = false; previewEndMessage = '';
  if (previewTarget) seekTarget = null;
  previewTarget = null; previewSound.cancelPending(); preview.seek(time); clearPreviewEffects();
  if (active && pause && player && !failed) {
    try { player.pauseVideo(); } catch { message('MVを一時停止できませんでした。プレーヤー内で停止してください。'); }
  }
  refreshPreviewControls();
}
function playPreview(position?: number): void {
  if (!player || failed || !model.chart.notes.length) return;
  readTime(); setArmed(false); sound.cancelPending();
  const resuming = previewing && position === undefined;
  previewing = true; previewEndMessage = ''; preview.sync(model.chart);
  clearPreviewEffects(); previewSound.cancelPending(); previewSound.setPlaybackActive(true); void previewSound.unlock();
  if (position !== undefined) { if (!seek(position)) return; if (previewTarget) previewTarget.includeExact = true; }
  else if (!resuming) preview.seek(time, true);
  try { player.playVideo(); }
  catch { stopPreview(false); message('再生を開始できませんでした。MV内の再生ボタンを押してください。'); }
  refreshPreviewControls();
}
const timeline = new Timeline(el<HTMLCanvasElement>('timeline'), {
  select: id => selectNote(id),
  range: range => chooseRange(range),
  move: (id, seconds, lane) => edit(() => model.move(id, seconds, lane)),
  resize: (id, end) => edit(() => model.resize(id, end)),
  seek: seconds => seek(seconds),
});
function refreshRange(): void {
  const count = selectedRange ? model.chart.notes.filter(note => inRange(note, selectedRange!)).length : 0;
  el('range-status').textContent = selectedRange ? `${selectedRange.start.toFixed(3)}〜${selectedRange.end.toFixed(3)}秒 · ${count}個のノーツを選択` : '「範囲を選択」に切り替えて横にドラッグ、または下の範囲編集で秒数を指定します。';
  for (const id of ['copy-range', 'delete-range']) el<HTMLButtonElement>(id).disabled = count === 0;
  el<HTMLButtonElement>('clear-range').disabled = selectedRange === null;
  el<HTMLButtonElement>('paste-range').disabled = clipboard === null;
}
function selectNote(id: number | null): void {
  selectedRange = null; model.selected = id; refreshRange(); refreshSelection(); refreshList();
}
function chooseRange(range: TimeRange | null): void {
  try {
    if (range) validateRange(range);
    selectedRange = range; model.selected = null;
    if (range) {
      el<HTMLDetailsElement>('range-panel').open = true;
      input('range-start').value = range.start.toFixed(3); input('range-end').value = range.end.toFixed(3);
      select('timeline-mode').value = 'range'; input('follow').checked = false;
    }
    refreshRange(); refreshSelection(); refreshList();
  } catch (error) { message(error instanceof Error ? error.message : '範囲を確認してください。'); }
}
function copyRange(): void {
  if (!selectedRange) return;
  try {
    clipboard = model.copyRange(selectedRange);
    el('clipboard-status').textContent = `${clipboard.notes.length}個をコピー済み · 区間の長さ ${(clipboard.end - clipboard.start).toFixed(3)}秒（このページ内で保持）`;
    message('範囲をコピーしました。貼り付け位置を指定してください。'); refreshRange();
  } catch (error) { message(error instanceof Error ? error.message : '範囲をコピーできませんでした。'); }
}
function pasteRange(): void {
  if (!clipboard) return;
  edit(() => {
    const at = input('paste-time').valueAsNumber, count = model.pasteRange(clipboard!, at);
    chooseRange({ start: at, end: at + clipboard!.end - clipboard!.start }); setView(Math.max(0, at - 0.25));
    message(`${count}個のノーツを貼り付けました。「元に戻す」でまとめて戻せます。`);
  });
}
function deleteRange(): void {
  if (selectedRange) edit(() => { const count = model.removeRange(selectedRange!); message(`${count}個のノーツを削除しました。「元に戻す」でまとめて戻せます。`); });
}
function setArmed(value: boolean): void {
  if (value) stopPreview(false);
  if (!value) captures.clear();
  sound.cancelPending();
  armed = value;
  el('record-toggle').setAttribute('aria-pressed', String(armed));
  el('record-toggle').textContent = armed ? '■ 打ち込み停止' : '● 打ち込み開始';
  lastAudition = null;
}
function save(): void {
  clearTimeout(saveTimer);
  el('save-status').textContent = storeChart(editorKey, model.chart) ? '編集内容をこのブラウザに保存しました。' : 'ブラウザに保存できません。JSONを書き出して保存してください。';
}
function changed(): void {
  preview.sync(model.chart);
  refresh();
  el('save-status').textContent = '保存中…';
  clearTimeout(saveTimer); saveTimer = window.setTimeout(save, 200);
  lastAudition = null;
}
function edit(operation: () => unknown): void {
  stopPreview(); setArmed(false);
  try { operation(); changed(); } catch (error) { message(error instanceof Error ? error.message : '編集できませんでした。'); refresh(); }
}
function refreshSelection(): void {
  refreshPreviewControls();
  const note = model.selectedNote;
  el('selected-panel').hidden = !note; el('selected-empty').hidden = Boolean(note);
  if (note) {
    input('note-time').value = note.time.toFixed(3); select('note-lane').value = String(note.lane);
    select('note-type').value = note.type; el('note-end-label').hidden = note.type !== 'hold';
    input('note-end').value = note.type === 'hold' ? note.endTime.toFixed(3) : '';
    select('chord-lane').querySelectorAll('option').forEach(option => { option.disabled = Number(option.value) === note.lane; });
    if (Number(select('chord-lane').value) === note.lane) select('chord-lane').value = String((note.lane + 3) % 6);
    el('source-info').textContent = note.sourceTime === undefined ? `ID ${note.id} · 手動追加のノーツ` : `ID ${note.id} · 元の入力 ${note.sourceTime.toFixed(3)}秒${note.type === 'hold' && note.sourceEndTime !== undefined ? `〜${note.sourceEndTime.toFixed(3)}秒` : ''} · 移動 ${(1000 * (note.time - note.sourceTime)).toFixed(1)}ms`;
  }
}
function refreshList(): void {
  const body = el('note-list'); body.replaceChildren();
  const notes = model.chart.notes.filter(note => note.time >= viewStart && note.time <= viewStart + viewSpan).slice(0, 100);
  for (const note of notes) {
    const row = document.createElement('tr'); row.dataset.selected = String(note.id === model.selected);
    const cell = document.createElement('td'), button = document.createElement('button');
    button.textContent = `#${note.id}`; button.setAttribute('aria-label', `ノーツ${note.id}を選択`);
    // Rebuilt lists don't retain listeners or old document closures.
    button.onclick = () => selectNote(note.id);
    cell.append(button); row.append(cell);
    for (const value of [note.time.toFixed(3), `${note.lane + 1} · ${'SDFJKL'[note.lane]}`, note.type === 'hold' ? `長押し → ${note.endTime.toFixed(3)}` : 'タップ', note.sourceTime?.toFixed(3) ?? '—']) { const td = document.createElement('td'); td.textContent = value; row.append(td); }
    body.append(row);
  }
}
function refresh(): void {
  input('editor-bpm').value = String(model.chart.bpm); input('beat-origin').value = String(model.chart.beatOrigin ?? model.chart.startTime);
  el('tempo-info').textContent = model.chart.tempoChanges?.length ? `${tempoLabel(model.chart)} BPM · ${model.chart.tempoChanges.length}箇所のテンポ変更を拍グリッド・スナップ・クオンタイズに反映します。BPM欄は開始時点の値です。` : '開始時点のBPMと拍の基準を合わせてください。BPM140はテスト用の仮の値です。';
  el('note-count').textContent = `${model.chart.notes.length} NOTES`;
  el<HTMLButtonElement>('undo').disabled = !model.canUndo; el<HTMLButtonElement>('redo').disabled = !model.canRedo;
  el<HTMLButtonElement>('quantize').disabled = !model.chart.notes.length;
  el<HTMLButtonElement>('try-game').disabled = !model.chart.notes.length;
  refreshSelection(); refreshList(); refreshRange();
  let overlaps = 0;
  for (let lane = 0; lane < 6; lane++) {
    let end = -Infinity, previousStart = -Infinity;
    for (const note of model.chart.notes.filter(note => note.lane === lane)) {
      if (note.time < end - 1e-8 || Math.abs(note.time - previousStart) <= 0.001) overlaps++;
      if (note.type === 'hold') end = Math.max(end, note.endTime);
      previousStart = note.time;
    }
  }
  el('collision-status').textContent = overlaps ? `同じレーンでノーツが${overlaps}個重なっています（長押しの区間も含む）。一覧で選択して移動・削除できます。` : '';
}
function setView(start: number, manual = false): void {
  viewStart = Math.min(MAX_TIME, Math.max(0, start)); input('view-start').value = viewStart.toFixed(3);
  if (manual) input('follow').checked = false;
  refreshList();
}
function seek(seconds: number): boolean {
  if (!player || failed) return false;
  try {
    seekTarget = Math.min(MAX_TIME, Math.max(0, seconds)); seekDeadline = performance.now() + 5000;
    captures.clear(); sound.cancelPending(); previewSound.cancelPending(); clearPreviewEffects();
    if (previewing) previewTarget = { time: seekTarget, includeExact: false };
    preview.seek(seekTarget);
    player.seekTo(seekTarget, true); clock.reset(); lastAudition = null;
    return true;
  } catch { seekTarget = null; stopPreview(false); message('シークできませんでした。プレーヤーを確認してください。'); return false; }
}
function readTime(): void {
  if (!player || failed) { playing = false; return; }
  try {
    const rate = player.getPlaybackRate();
    if (rate !== playbackRate) {
      cancelCaptures(); sound.cancelPending(); previewSound.cancelPending(); lastAudition = null; clock.reset();
      playbackRate = rate; reflectRate();
    }
    if (rateRequest && (rate === rateRequest.rate || performance.now() >= rateRequest.deadline)) {
      const rejected = rate !== rateRequest.rate; rateRequest = null; reflectRate(rejected);
    }
    const sample = clock.sample(player.getCurrentTime(), player.getPlayerState(), performance.now(), rate);
    time = sample.time;
    if (sample.seek) {
      sound.cancelPending(); previewSound.cancelPending(); clearPreviewEffects();
      if (!previewTarget) preview.seek(time);
      lastAudition = null; cancelCaptures();
    }
    if (!sample.playing) cancelCaptures();
    if (seekTarget !== null) {
      if (Math.abs(sample.rawTime - seekTarget) <= 0.5) {
        seekTarget = null;
        if (previewTarget) { preview.seek(previewTarget.time, previewTarget.includeExact); previewTarget = null; }
      }
      else if (performance.now() > seekDeadline) { seekTarget = null; stopPreview(); message('シークが完了しませんでした。プレーヤーを確認してください。'); }
      else { playing = false; return; }
    }
    if (playing && !sample.playing) { sound.cancelPending(); previewSound.cancelPending(); }
    playing = sample.playing && !calibration.active;
    const label = sample.stale ? '動画時刻の更新待ち' : playing ? 'MV再生中' : '停止・一時停止・読み込み中';
    if (el('player-status').textContent !== label) el('player-status').textContent = label;
  } catch { playing = false; stopPreview(); message('動画の再生時刻を取得できません。プレーヤーを確認してください。'); }
}
const disposePlayer = createYouTubePlayer({
  keyboardTarget: el('record-pads'),
  ready: instance => {
    if (failed) return;
    player = instance; clock.reset();
    for (const id of ['record-toggle', 'set-origin', 'add-note', 'seek-note', 'paste-now']) el<HTMLButtonElement>(id).disabled = false;
    reflectRate();
    el('player-status').textContent = 'MVの再生ボタンを押してください';
    refreshPreviewControls();
  },
  rate: () => { if (player && !failed) { readTime(); reflectRate(); } },
  state: next => {
    sound.setPlaybackActive(next === 1 && !previewing && input('editor-sound').checked);
    previewSound.setPlaybackActive(next === 1 && previewing);
    if (next !== 1) { sound.cancelPending(); previewSound.cancelPending(); }
    else void (previewing ? previewSound : sound).unlock();
    if (next === 0 && previewing) { stopPreview(false); previewEndMessage = 'MVの再生が終了しました。'; }
    lastAudition = null;
  },
  error: text => {
    sound.cancelPending();
    failed = true; playing = false; setArmed(false); stopPreview(false);
    el('player-error').hidden = false; el('player-error').textContent = `${text} JSONの読み込み・編集・保存は引き続き使えます。`;
    el('player-status').textContent = '動画を再生できません';
    for (const id of ['record-toggle', 'set-origin', 'add-note', 'seek-note', 'paste-now', 'editor-playback-rate']) el<HTMLInputElement>(id).disabled = true;
  },
}, song);
function reflectRate(rejected = false): void {
  if (!player || failed) return;
  const control = select('editor-playback-rate');
  const available = player.getAvailablePlaybackRates();
  const actual = player.getPlaybackRate();
  if (![...control.options].some(option => Number(option.value) === actual)) control.add(new Option(`${actual}倍（MV）`, String(actual)));
  for (const option of control.options) option.disabled = !available.includes(Number(option.value));
  control.disabled = !available.some(rate => [0.5, 0.75, 1].includes(rate));
  control.value = String(rateRequest?.rate ?? actual);
  el('rate-status').textContent = rateRequest ? `${rateRequest.rate}倍への変更を待っています…` :
    `${rejected ? '指定速度に切り替えられませんでした。' : ''}現在${actual}倍 · 打ち込み・再生確認に共通。譜面は原曲の時刻で保存し、ゲームは1倍で再生します。`;
}
select('editor-playback-rate').addEventListener('change', () => {
  if (!player || failed) return;
  readTime(); cancelCaptures(); sound.cancelPending(); previewSound.cancelPending(); lastAudition = null;
  rateRequest = { rate: Number(select('editor-playback-rate').value), deadline: performance.now() + 2000 };
  try { player.setPlaybackRate(rateRequest.rate); reflectRate(); }
  catch { rateRequest = null; reflectRate(true); }
}, { signal });
function cancelCaptures(): void {
  if (!captures.size) return;
  captures.clear(); message('未完了の長押しを破棄しました。再生を確認してもう一度打ち込んでください。');
}
const buttons = [...document.querySelectorAll<HTMLButtonElement>('.lane-button')];
buttons.forEach((button, lane) => button.style.setProperty('--lane', LANE_COLORS[lane]));
const unbindInput = bindInput(buttons, lane => {
  if (calibration.active || previewing) return;
  readTime(); const captured = Math.max(0, compensateInput(time, settings.inputOffset, playbackRate)), record = armed && playing;
  if (input('editor-sound').checked) sound.play(lane);
  if (!record) return;
  if (select('record-type').value === 'hold') {
    if (pressed.has(lane) && !captures.has(lane)) captures.set(lane, captured);
    return;
  }
  try { model.add(captured, lane, true); changed(); } catch (error) { setArmed(false); message(error instanceof Error ? error.message : '記録できませんでした。'); }
}, (lanes, reason) => {
  const previous = pressed; pressed = lanes;
  if (calibration.active || previewing) return;
  const released = [...previous].filter(lane => !lanes.has(lane));
  if (!released.length || !captures.size) return;
  if (reason === 'cancel') { released.forEach(lane => captures.delete(lane)); message('入力がキャンセルされたため未完了の長押しを破棄しました。'); return; }
  readTime();
  for (const lane of released) {
    const start = captures.get(lane); captures.delete(lane);
    if (start === undefined || !armed || !playing) continue;
    const end = Math.max(0, compensateInput(time, settings.inputOffset, playbackRate));
    if (end - start < MIN_HOLD) { message('長押しは30ms以上保持してください。'); continue; }
    try { model.add(start, lane, true, end); changed(); } catch (error) { message(error instanceof Error ? error.message : '長押しを記録できませんでした。'); }
  }
}, () => calibration.active || previewing);
el('record-pads').addEventListener('pointerdown', event => { if (event.pointerType === 'mouse' && event.target === el('record-pads')) el('record-pads').focus({ preventScroll: true }); }, { signal });
el('record-toggle').addEventListener('click', () => { setArmed(!armed); el('record-pads').focus({ preventScroll: true }); }, { signal });
const on = (id: string, callback: () => void) => el(id).addEventListener('click', callback, { signal });
el('load-bundled-chart').hidden = !bundled;
on('load-bundled-chart', () => {
  if (bundled) edit(() => { model.replace(bundled); setView(Math.max(0, bundled.startTime - 1)); message('収録譜面を読み込みました。「元に戻す」で前の編集内容に戻せます。'); });
});
on('select-range', () => chooseRange({ start: input('range-start').valueAsNumber, end: input('range-end').valueAsNumber }));
on('select-view-range', () => chooseRange({ start: viewStart, end: Math.min(MAX_TIME, viewStart + viewSpan) }));
on('clear-range', () => chooseRange(null)); on('copy-range', copyRange); on('delete-range', deleteRange); on('paste-range', pasteRange);
on('paste-now', () => { readTime(); input('paste-time').value = time.toFixed(3); });
select('timeline-mode').addEventListener('change', () => { if (select('timeline-mode').value === 'notes') chooseRange(null); else el<HTMLDetailsElement>('range-panel').open = true; }, { signal });
on('preview-play', () => playPreview());
on('preview-first', () => playPreview(previewStart(undefined, preview.first, settings.travel)));
on('preview-selected', () => { if (model.selectedNote) playPreview(previewStart(model.selectedNote, preview.first, settings.travel)); });
on('preview-pause', () => {
  if (!player || failed) return;
  previewSound.cancelPending();
  try { player.pauseVideo(); } catch { message('MVを一時停止できませんでした。プレーヤー内で停止してください。'); }
});
on('preview-stop', () => stopPreview());
input('preview-sound').addEventListener('change', () => { previewSound.enabled = input('preview-sound').checked; if (previewSound.enabled && previewing) void previewSound.unlock(); }, { signal });
input('preview-volume').addEventListener('input', () => { previewSound.volume = input('preview-volume').valueAsNumber; el('preview-volume-value').textContent = `${previewSound.volume}%`; if (previewing) void previewSound.unlock(); }, { signal });
select('record-type').addEventListener('change', cancelCaptures, { signal });
const metadata = () => edit(() => model.metadata(input('editor-bpm').valueAsNumber, input('beat-origin').valueAsNumber));
input('editor-bpm').addEventListener('change', metadata, { signal }); input('beat-origin').addEventListener('change', metadata, { signal });
on('set-origin', () => { readTime(); edit(() => model.metadata(model.chart.bpm, Math.round(time * 1000) / 1000)); });
on('quantize', () => {
  if (select('quantize-target').value === 'selected' && !model.selectedNote) { message('先にノーツを選択してください。'); return; }
  edit(() => model.quantize(division(), select('quantize-target').value === 'selected', input('from-source').checked));
  message('拍にそろえました。元の入力位置は薄い輪郭で表示します。');
});
on('undo', () => edit(() => model.undo())); on('redo', () => edit(() => model.redo()));
function moveSelected(delta?: number): void {
  const note = model.selectedNote; if (!note) return;
  edit(() => model.move(note.id, delta === undefined ? input('note-time').valueAsNumber : Math.max(0, Math.min(MAX_TIME, note.time + delta)), delta === undefined ? Number(select('note-lane').value) : note.lane));
}
input('note-time').addEventListener('change', () => moveSelected(), { signal }); select('note-lane').addEventListener('change', () => moveSelected(), { signal });
select('note-type').addEventListener('change', () => {
  const note = model.selectedNote; if (!note) return;
  edit(() => model.changeType(select('note-type').value as 'tap' | 'hold', note.type === 'hold' ? note.endTime : beatToTime(model.chart, timeToBeat(model.chart, note.time) + 1)));
}, { signal });
input('note-end').addEventListener('change', () => { const note = model.selectedNote; if (note) edit(() => model.resize(note.id, input('note-end').valueAsNumber)); }, { signal });
on('add-chord', () => edit(() => model.addChord(Number(select('chord-lane').value))));
on('nudge-minus', () => moveSelected(-0.01)); on('nudge-plus', () => moveSelected(0.01));
on('delete-note', () => edit(() => model.remove()));
on('seek-note', () => { const note = model.selectedNote; if (note) { setView(Math.max(0, note.time - 1)); seek(note.time - 1); } });
select('add-type').addEventListener('change', () => { el('add-length-label').hidden = select('add-type').value !== 'hold'; }, { signal });
on('add-note', () => {
  readTime();
  edit(() => {
    const length = input('add-length').valueAsNumber;
    if (select('add-type').value === 'hold' && (!Number.isFinite(length) || length < 0.25 || length > 16)) throw new Error('長押しの長さは0.25〜16拍にしてください。');
    return model.add(time, Number(select('add-lane').value), false, select('add-type').value === 'hold' ? beatToTime(model.chart, timeToBeat(model.chart, time) + length) : undefined);
  });
});
input('view-start').addEventListener('change', () => { const value = input('view-start').valueAsNumber; setView(Number.isFinite(value) ? value : viewStart, true); }, { signal });
select('view-span').addEventListener('change', () => { viewSpan = Number(select('view-span').value); refreshList(); }, { signal });
on('view-prev', () => setView(viewStart - viewSpan, true)); on('view-next', () => setView(viewStart + viewSpan, true)); on('view-now', () => { readTime(); setView(Math.max(0, time - viewSpan / 4)); });
input('audition').addEventListener('change', () => { sound.cancelPending(); lastAudition = null; if (input('audition').checked && !previewing) sound.play(0); }, { signal });
on('export-chart', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(model.chart, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'hey-rhythm-chart.json'; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000); message('JSONを書き出しました。元の入力時刻も含まれます。');
});
input('import-chart').addEventListener('change', async () => {
  const file = input('import-chart').files?.[0]; if (!file) return;
  stopPreview(); setArmed(false);
  try {
    if (file.size > 1024 * 1024) throw new Error('JSONは1MB以内にしてください。');
    const chart = parseChart(await file.text(), false, song);
    model.replace(chart); setView(Math.max(0, chart.startTime - 1)); changed(); message('JSONを読み込みました。「元に戻す」で前の譜面に戻せます。');
  } catch (error) { message(error instanceof Error ? error.message : 'JSONを読み込めませんでした。'); }
  input('import-chart').value = '';
}, { signal });
on('new-chart', () => { edit(() => model.replace(emptyChart(song))); setView(0); message('空の譜面にしました。「元に戻す」で前の譜面に戻せます。'); });
on('try-game', () => {
  stopPreview(); setArmed(false); save();
  if (!model.chart.notes.length) return;
  if (!storeChart(customKey, model.chart)) { message('試遊用の譜面を保存できません。ブラウザのストレージ設定を確認してください。JSONの書き出しは利用できます。'); return; }
  location.href = songUrl(song, 'game', true);
});
window.addEventListener('keydown', event => {
  if (calibration.active) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('input,textarea,select,[contenteditable="true"]')) return;
  if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.code === 'KeyZ' || event.code === 'KeyY')) {
    event.preventDefault(); edit(() => event.code === 'KeyY' || event.shiftKey ? model.redo() : model.undo()); return;
  }
  if (document.activeElement === el('timeline')) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === 'KeyC' && selectedRange) { event.preventDefault(); copyRange(); return; }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === 'KeyV' && clipboard) { event.preventDefault(); pasteRange(); return; }
    if (event.code === 'Escape' && selectedRange) { event.preventDefault(); chooseRange(null); return; }
    if ((event.code === 'Delete' || event.code === 'Backspace') && selectedRange) { event.preventDefault(); deleteRange(); return; }
  }
  if (document.activeElement === el('timeline') && model.selectedNote) {
    if (event.code === 'Delete' || event.code === 'Backspace') { event.preventDefault(); edit(() => model.remove()); }
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') { event.preventDefault(); moveSelected((event.code === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 0.001 : 0.01)); }
  }
}, { signal });
window.addEventListener('pagehide', save, { signal });
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopPreview(); save(); } }, { signal });
function reflectTiming(): void {
  input('editor-input-offset').value = String(settings.inputOffset);
  input('editor-sound-delay').value = String(settings.soundDelay);
  el('editor-input-offset-value').textContent = `${settings.inputOffset > 0 ? '+' : ''}${settings.inputOffset} ms`;
  el('editor-sound-delay-value').textContent = `${settings.soundDelay} ms`;
  sound.delay = settings.soundDelay;
}
function changeTiming(): void {
  const previous = settings.inputOffset;
  settings = normalizeSettings({ ...settings, inputOffset: input('editor-input-offset').valueAsNumber, soundDelay: input('editor-sound-delay').valueAsNumber });
  if (settings.inputOffset !== previous) cancelCaptures();
  reflectTiming();
  if (!saveSettings(settings)) message('タイミング設定を保存できません。このページ内では反映します。');
}
input('editor-input-offset').addEventListener('input', changeTiming, { signal });
input('editor-sound-delay').addEventListener('input', changeTiming, { signal });
const calibration = createCalibrationDialog({
  pause() {
    stopPreview(); setArmed(false); sound.cancelPending(); lastAudition = null;
    player?.pauseVideo();
  },
  apply(value) { input('editor-input-offset').value = String(value); changeTiming(); },
});
on('editor-auto-calibrate', () => calibration.open());
on('editor-timing-reset', () => { input('editor-input-offset').value = '0'; input('editor-sound-delay').value = '0'; changeTiming(); });
on('editor-sound-test', () => sound.play(0));
reflectTiming();
input('editor-note-size').value = String(settings.noteSize); el('editor-note-size-value').textContent = `${settings.noteSize}%`;
input('editor-note-size').addEventListener('input', () => {
  // Re-read shared settings so editing note size doesn't overwrite a game preference from another tab.
  settings = normalizeSettings({ ...loadSettings(), inputOffset: settings.inputOffset, soundDelay: settings.soundDelay, noteSize: input('editor-note-size').valueAsNumber });
  el('editor-note-size-value').textContent = `${settings.noteSize}%`;
  if (!saveSettings(settings)) message('ノーツ幅をブラウザに保存できません。このページ内では反映します。');
}, { signal });
setView(viewStart); refresh(); el('save-status').textContent = 'このブラウザに自動保存します。バックアップにはJSONを書き出してください。';
function frame(now: number): void {
  if (disposed) return;
  readTime();
  if (playing && input('follow').checked && !timeline.dragging && (time < viewStart || time > viewStart + viewSpan * 0.9)) setView(Math.floor(time / (viewSpan * 0.75)) * (viewSpan * 0.75));
  sound.setPlaybackActive(playing && !previewing && input('editor-sound').checked);
  previewSound.setPlaybackActive(playing && previewing && seekTarget === null);
  if (!previewing && playing && !armed && input('audition').checked) {
    if (lastAudition !== null && time > lastAudition && time - lastAudition < 0.5) model.chart.notes.filter(note => note.time > lastAudition! && note.time <= time).slice(0, 12).forEach(note => sound.play(note.lane));
    lastAudition = time;
  } else lastAudition = null;
  preview.sync(model.chart);
  const previewEvents = seekTarget === null ? preview.update(time, playing && previewing) : [];
  previewEvents.forEach(event => {
    previewSound.play(event.lane); previewRenderer.flash(event.lane, now);
    previewFeedback[event.lane] = now;
    previewLabels[event.lane] = event.phase === 'end' ? '離す' : event.phase === 'start' ? 'HOLD' : 'TAP';
  });
  const holds = new Set(preview.notes.filter(note => note.state === 'holding').map(note => note.lane));
  previewSound.syncHolds(previewing && playing && seekTarget === null ? holds : new Set(), now);
  previewRenderer.pressed = previewing ? holds : new Set();
  previewRenderer.draw(preview.notes, time, settings.travel, now, settings.noteSize, bpmAt(model.chart, time), 0, previewing && playing && seekTarget === null, model.chart);
  previewLanes.forEach((lane, i) => {
    const holding = previewing && holds.has(i), recent = previewing && now - previewFeedback[i] < 180;
    lane.classList.toggle('active', holding || recent);
    lane.dataset.state = holding ? 'holding' : recent ? 'pulse' : 'idle';
    lane.querySelector('output')!.textContent = holding ? 'HOLD' : recent ? previewLabels[i] : '—';
  });
  if (previewing && playing && seekTarget === null && time >= preview.end + 0.35) {
    stopPreview(); previewEndMessage = 'プレビュー完了 · 譜面の最後まで再生しました。';
  }
  timeline.draw({ chart: model.chart, noteSize: settings.noteSize, selected: model.selected, range: selectedRange, rangeMode: select('timeline-mode').value === 'range', start: viewStart, span: viewSpan, division: division(), snap: input('drag-snap').checked, time });
  if (now - lastUi > 100) {
    refreshPreviewControls();
    const previewStatus = failed ? '動画を再生できません。編集・保存は引き続き使えます。' : !model.chart.notes.length ? 'ノーツを追加すると再生できます。'
      : !player ? 'YouTubeプレーヤーを読み込み中…' : previewEndMessage || `${previewing ? seekTarget !== null ? '開始位置へ移動中' : playing ? 'プレビュー再生中' : '一時停止・再生待ち' : '停止中'} · ${time.toFixed(3)} s`;
    el('preview-status').textContent = previewStatus;
    lastUi = now; el('playhead').textContent = `${time.toFixed(3)} s`;
    el('record-status').textContent = armed ? playing ? captures.size ? `● 長押し記録中 ${captures.size}本 · 離すと保存します` : '● 打ち込み中 · キーまたは6ボタンを押してください' : '● 打ち込み待機 · MVを再生してください（一時停止・読み込み中は記録しません）' : '打ち込み停止中 · ノーツを選択して編集できます';
  }
  frameId = requestAnimationFrame(frame);
}
frameId = requestAnimationFrame(frame);
if (import.meta.hot) import.meta.hot.dispose(() => { disposed = true; cancelAnimationFrame(frameId); clearTimeout(saveTimer); save(); listeners.abort(); unbindInput(); timeline.destroy(); previewRenderer.destroy(); unbindPreviewTargets(); previewSound.destroy(); sound.destroy(); calibration.destroy(); disposePlayer(); });
}
