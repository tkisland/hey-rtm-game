import './style.css';
import './editor.css';
import { LANE_COLORS } from './colors';
import { CUSTOM_CHART_KEY, EDITOR_KEY, EditorModel, MAX_TIME, MIN_HOLD, emptyChart, loadChart, parseChart, storeChart } from './editor-model';
import type { Division } from './editor-model';
import { bindInput } from './input';
import { loadSettings, normalizeSettings, saveSettings } from './settings';
import { TapSound } from './sound';
import { VideoClock } from './sync';
import { Timeline } from './timeline';
import { createYouTubePlayer } from './youtube';
import type { YouTubePlayer } from './youtube';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id); if (!node) throw new Error(`Missing editor element: ${id}`);
  return node as T;
}
const input = (id: string) => el<HTMLInputElement>(id);
const select = (id: string) => el<HTMLSelectElement>(id);
const model = new EditorModel(loadChart(EDITOR_KEY) ?? emptyChart());
const clock = new VideoClock();
const sound = new TapSound(() => message('確認音を再生できません。端末の音量・ブラウザの音声設定をご確認ください。'));
let settings = loadSettings(); sound.volume = settings.soundVolume;
input('editor-sound').checked = settings.sound;
const listeners = new AbortController(), signal = listeners.signal;
let player: YouTubePlayer | null = null;
let failed = false, armed = false, disposed = false, time = 0, playing = false;
let viewStart = Math.max(0, model.chart.startTime - 1), viewSpan = 4, saveTimer = 0, frameId = 0, lastUi = 0, lastAudition: number | null = null;
const captures = new Map<number, number>();
let pressed = new Set<number>();
let seekTarget: number | null = null, seekDeadline = 0;
const division = (): Division => Number(select('division').value) as Division;
const message = (text: string) => { el('editor-notice').textContent = text; };
const timeline = new Timeline(el<HTMLCanvasElement>('timeline'), {
  select: id => { model.selected = id; refreshSelection(); refreshList(); },
  move: (id, seconds, lane) => edit(() => model.move(id, seconds, lane)),
  resize: (id, end) => edit(() => model.resize(id, end)),
  seek: seconds => seek(seconds),
});
function setArmed(value: boolean): void {
  if (!value) captures.clear();
  armed = value;
  el('record-toggle').setAttribute('aria-pressed', String(armed));
  el('record-toggle').textContent = armed ? '■ 打ち込み停止' : '● 打ち込み開始';
  lastAudition = null;
}
function save(): void {
  clearTimeout(saveTimer);
  el('save-status').textContent = storeChart(EDITOR_KEY, model.chart) ? '編集内容をこのブラウザに保存しました。' : 'ブラウザに保存できません。JSONを書き出して保存してください。';
}
function changed(): void {
  refresh();
  el('save-status').textContent = '保存中…';
  clearTimeout(saveTimer); saveTimer = window.setTimeout(save, 200);
  lastAudition = null;
}
function edit(operation: () => unknown): void {
  setArmed(false);
  try { operation(); changed(); } catch (error) { message(error instanceof Error ? error.message : '編集できませんでした。'); refresh(); }
}
function refreshSelection(): void {
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
    button.onclick = () => { model.selected = note.id; refreshSelection(); refreshList(); };
    cell.append(button); row.append(cell);
    for (const value of [note.time.toFixed(3), `${note.lane + 1} · ${'SDFJKL'[note.lane]}`, note.type === 'hold' ? `長押し → ${note.endTime.toFixed(3)}` : 'タップ', note.sourceTime?.toFixed(3) ?? '—']) { const td = document.createElement('td'); td.textContent = value; row.append(td); }
    body.append(row);
  }
}
function refresh(): void {
  input('editor-bpm').value = String(model.chart.bpm); input('beat-origin').value = String(model.chart.beatOrigin ?? model.chart.startTime);
  el('note-count').textContent = `${model.chart.notes.length} NOTES`;
  el<HTMLButtonElement>('undo').disabled = !model.canUndo; el<HTMLButtonElement>('redo').disabled = !model.canRedo;
  el<HTMLButtonElement>('quantize').disabled = !model.chart.notes.length;
  el<HTMLButtonElement>('try-game').disabled = !model.chart.notes.length;
  refreshSelection(); refreshList();
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
function seek(seconds: number): void {
  if (!player || failed) return;
  try {
    seekTarget = Math.min(MAX_TIME, Math.max(0, seconds)); seekDeadline = performance.now() + 5000;
    captures.clear();
    player.seekTo(seekTarget, true); clock.reset(); lastAudition = null;
  } catch { seekTarget = null; message('シークできませんでした。プレーヤーを確認してください。'); }
}
function readTime(): void {
  if (!player || failed) { playing = false; return; }
  try {
    const sample = clock.sample(player.getCurrentTime(), player.getPlayerState(), performance.now(), player.getPlaybackRate());
    time = sample.time;
    if (sample.seek) { lastAudition = null; cancelCaptures(); }
    if (!sample.playing) cancelCaptures();
    if (seekTarget !== null) {
      if (Math.abs(sample.rawTime - seekTarget) <= 0.5) seekTarget = null;
      else if (performance.now() > seekDeadline) { seekTarget = null; message('シークが完了しませんでした。プレーヤーを確認してください。'); }
      else { playing = false; return; }
    }
    playing = sample.playing;
    const label = sample.stale ? '動画時刻の更新待ち' : playing ? 'MV再生中' : '停止・一時停止・読み込み中';
    if (el('player-status').textContent !== label) el('player-status').textContent = label;
  } catch { playing = false; message('動画の再生時刻を取得できません。プレーヤーを確認してください。'); }
}
const disposePlayer = createYouTubePlayer({
  ready: instance => {
    if (failed) return;
    player = instance; clock.reset();
    for (const id of ['record-toggle', 'set-origin', 'add-note', 'seek-note']) el<HTMLButtonElement>(id).disabled = false;
    el('player-status').textContent = 'MVの再生ボタンを押してください';
  },
  state: () => { lastAudition = null; },
  error: text => {
    failed = true; playing = false; setArmed(false);
    el('player-error').hidden = false; el('player-error').textContent = `${text} JSONの読み込み・編集・保存は引き続き使えます。`;
    el('player-status').textContent = '動画を再生できません';
    for (const id of ['record-toggle', 'set-origin', 'add-note', 'seek-note']) el<HTMLButtonElement>(id).disabled = true;
  },
});
function cancelCaptures(): void {
  if (!captures.size) return;
  captures.clear(); message('未完了の長押しを破棄しました。再生を確認してもう一度打ち込んでください。');
}
const buttons = [...document.querySelectorAll<HTMLButtonElement>('.lane-button')];
buttons.forEach((button, lane) => button.style.setProperty('--lane', LANE_COLORS[lane]));
const unbindInput = bindInput(buttons, lane => {
  readTime(); const captured = time, record = armed && playing;
  if (input('editor-sound').checked) sound.play(lane);
  if (!record) return;
  if (select('record-type').value === 'hold') {
    if (pressed.has(lane) && !captures.has(lane)) captures.set(lane, captured);
    return;
  }
  try { model.add(captured, lane, true); changed(); } catch (error) { setArmed(false); message(error instanceof Error ? error.message : '記録できませんでした。'); }
}, (lanes, reason) => {
  const previous = pressed; pressed = lanes;
  const released = [...previous].filter(lane => !lanes.has(lane));
  if (!released.length || !captures.size) return;
  if (reason === 'cancel') { released.forEach(lane => captures.delete(lane)); message('入力がキャンセルされたため未完了の長押しを破棄しました。'); return; }
  readTime();
  for (const lane of released) {
    const start = captures.get(lane); captures.delete(lane);
    if (start === undefined || !armed || !playing) continue;
    if (time - start < MIN_HOLD) { message('長押しは30ms以上保持してください。'); continue; }
    try { model.add(start, lane, true, time); changed(); } catch (error) { message(error instanceof Error ? error.message : '長押しを記録できませんでした。'); }
  }
});
el('record-pads').addEventListener('pointerdown', event => { if (event.pointerType === 'mouse' && event.target === el('record-pads')) el('record-pads').focus({ preventScroll: true }); }, { signal });
el('record-toggle').addEventListener('click', () => { setArmed(!armed); el('record-pads').focus({ preventScroll: true }); }, { signal });
const on = (id: string, callback: () => void) => el(id).addEventListener('click', callback, { signal });
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
  edit(() => model.changeType(select('note-type').value as 'tap' | 'hold', note.type === 'hold' ? note.endTime : note.time + 60 / model.chart.bpm));
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
    return model.add(time, Number(select('add-lane').value), false, select('add-type').value === 'hold' ? time + length * 60 / model.chart.bpm : undefined);
  });
});
input('view-start').addEventListener('change', () => { const value = input('view-start').valueAsNumber; setView(Number.isFinite(value) ? value : viewStart, true); }, { signal });
select('view-span').addEventListener('change', () => { viewSpan = Number(select('view-span').value); refreshList(); }, { signal });
on('view-prev', () => setView(viewStart - viewSpan, true)); on('view-next', () => setView(viewStart + viewSpan, true)); on('view-now', () => { readTime(); setView(Math.max(0, time - viewSpan / 4)); });
input('audition').addEventListener('change', () => { lastAudition = null; if (input('audition').checked) sound.play(0); }, { signal });
on('export-chart', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(model.chart, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'hey-rhythm-chart.json'; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000); message('JSONを書き出しました。元の入力時刻も含まれます。');
});
input('import-chart').addEventListener('change', async () => {
  const file = input('import-chart').files?.[0]; if (!file) return;
  setArmed(false);
  try {
    if (file.size > 1024 * 1024) throw new Error('JSONは1MB以内にしてください。');
    const chart = parseChart(await file.text());
    model.replace(chart); setView(Math.max(0, chart.startTime - 1)); changed(); message('JSONを読み込みました。「元に戻す」で前の譜面に戻せます。');
  } catch (error) { message(error instanceof Error ? error.message : 'JSONを読み込めませんでした。'); }
  input('import-chart').value = '';
}, { signal });
on('new-chart', () => { edit(() => model.replace(emptyChart())); setView(0); message('空の譜面にしました。「元に戻す」で前の譜面に戻せます。'); });
on('try-game', () => {
  setArmed(false); save();
  if (!model.chart.notes.length) return;
  if (!storeChart(CUSTOM_CHART_KEY, model.chart)) { message('試遊用の譜面を保存できません。ブラウザのストレージ設定を確認してください。JSONの書き出しは利用できます。'); return; }
  location.href = './?chart=custom';
});
window.addEventListener('keydown', event => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('input,textarea,select,[contenteditable="true"]')) return;
  if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.code === 'KeyZ' || event.code === 'KeyY')) {
    event.preventDefault(); edit(() => event.code === 'KeyY' || event.shiftKey ? model.redo() : model.undo()); return;
  }
  if (document.activeElement === el('timeline') && model.selectedNote) {
    if (event.code === 'Delete' || event.code === 'Backspace') { event.preventDefault(); edit(() => model.remove()); }
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') { event.preventDefault(); moveSelected((event.code === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 0.001 : 0.01)); }
  }
}, { signal });
window.addEventListener('pagehide', save, { signal });
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); }, { signal });
input('editor-note-size').value = String(settings.noteSize); el('editor-note-size-value').textContent = `${settings.noteSize}%`;
input('editor-note-size').addEventListener('input', () => {
  // Re-read shared settings so editing note size doesn't overwrite a game preference from another tab.
  settings = normalizeSettings({ ...loadSettings(), noteSize: input('editor-note-size').valueAsNumber });
  el('editor-note-size-value').textContent = `${settings.noteSize}%`;
  if (!saveSettings(settings)) message('ノーツ幅をブラウザに保存できません。このページ内では反映します。');
}, { signal });
setView(viewStart); refresh(); el('save-status').textContent = 'このブラウザに自動保存します。バックアップにはJSONを書き出してください。';
function frame(now: number): void {
  if (disposed) return;
  readTime();
  if (playing && input('follow').checked && !timeline.dragging && (time < viewStart || time > viewStart + viewSpan * 0.9)) setView(Math.floor(time / (viewSpan * 0.75)) * (viewSpan * 0.75));
  if (playing && !armed && input('audition').checked) {
    if (lastAudition !== null && time > lastAudition && time - lastAudition < 0.5) model.chart.notes.filter(note => note.time > lastAudition! && note.time <= time).slice(0, 12).forEach(note => sound.play(note.lane));
    lastAudition = time;
  } else lastAudition = null;
  timeline.draw({ chart: model.chart, noteSize: settings.noteSize, selected: model.selected, start: viewStart, span: viewSpan, division: division(), snap: input('drag-snap').checked, time });
  if (now - lastUi > 100) {
    lastUi = now; el('playhead').textContent = `${time.toFixed(3)} s`;
    el('record-status').textContent = armed ? playing ? captures.size ? `● 長押し記録中 ${captures.size}本 · 離すと保存します` : '● 打ち込み中 · キーまたは6ボタンを押してください' : '● 打ち込み待機 · MVを再生してください（一時停止・読み込み中は記録しません）' : '打ち込み停止中 · ノーツを選択して編集できます';
  }
  frameId = requestAnimationFrame(frame);
}
frameId = requestAnimationFrame(frame);
if (import.meta.hot) import.meta.hot.dispose(() => { disposed = true; cancelAnimationFrame(frameId); clearTimeout(saveTimer); save(); listeners.abort(); unbindInput(); timeline.destroy(); sound.destroy(); disposePlayer(); });
