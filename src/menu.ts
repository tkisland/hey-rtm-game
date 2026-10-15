import './style.css';
import './menu.css';
import { LANE_COLORS } from './colors';
import { CUSTOM_CHART_KEY, EDITOR_KEY, loadChart, storeChart } from './editor-model';
import { findSong, SONGS, songStorageKey, songUrl } from './songs';
import type { Song } from './songs';
import { bundledChart } from './bundled-charts';
import { tempoLabel } from './tempo';

const list = document.getElementById('song-list')!;
const search = document.getElementById('song-search') as HTMLInputElement;
const notice = document.getElementById('menu-notice')!;
const listeners = new AbortController();
const savedChart = (song: Song) => loadChart(songStorageKey(EDITOR_KEY, song), true, song) ?? loadChart(songStorageKey(CUSTOM_CHART_KEY, song), true, song);
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
}
function showNotice(text: string): void { notice.textContent = text; notice.hidden = false; }
function render(): void {
  const query = search.value.trim().toLocaleLowerCase();
  const songs = SONGS.filter(song => `${song.title} ${song.artist}`.toLocaleLowerCase().includes(query));
  list.replaceChildren();
  document.getElementById('song-count')!.textContent = `${songs.length}曲 / 全${SONGS.length}曲`;
  document.getElementById('song-empty')!.hidden = songs.length > 0;
  songs.forEach(song => {
    const saved = savedChart(song), bundled = bundledChart(song), card = node('article', 'song-card'); card.dataset.song = song.id;
    const artwork = node('div', 'song-art'); artwork.setAttribute('aria-hidden', 'true');
    artwork.append(node('span', 'cover-number', String(SONGS.indexOf(song) + 1).padStart(2, '0')), node('strong', 'cover-title', song.title));
    const lanes = node('div', 'cover-lanes');
    for (const color of LANE_COLORS) { const lane = node('i', ''); lane.style.setProperty('--color', color); lanes.append(lane); }
    artwork.append(lanes);
    const body = node('div', 'song-card-body');
    body.append(node('p', 'song-artist', song.artist), node('h2', 'song-name', song.title), node('p', 'song-meta', bundled ? `6 LANES · SMG002 · ${tempoLabel(bundled)} BPM · ${bundled.notes.length} NOTES` : `6 LANES · テスト譜面 ${song.bpm} BPM`));
    body.append(node('p', 'saved-summary', saved ? `保存譜面あり · ${saved.notes.length} NOTES` : '保存譜面はまだありません。編集から作成できます。'));
    const actions = node('div', 'song-actions');
    const play = node('a', 'song-play', bundled ? '収録譜面で遊ぶ' : 'テスト譜面で遊ぶ'); play.href = songUrl(song, 'game', bundled ? 'bundled' : 'test');
    const custom = node('button', 'song-saved', '保存譜面で遊ぶ'); custom.type = 'button'; custom.disabled = !saved;
    custom.addEventListener('click', () => {
      const latest = savedChart(song);
      if (!latest) { showNotice('保存譜面を読み込めませんでした。「譜面を編集」から確認してください。'); render(); return; }
      if (!storeChart(songStorageKey(CUSTOM_CHART_KEY, song), latest)) { showNotice('試遊用の譜面を保存できません。ブラウザの保存設定を確認するか、譜面エディターでJSONを書き出してください。'); return; }
      location.href = songUrl(song, 'game', true);
    });
    const edit = node('a', 'song-edit', '譜面を編集 →'); edit.href = songUrl(song, 'editor');
    actions.append(play, custom, edit);
    if (bundled) { const practice = node('a', 'song-practice', 'テスト譜面で遊ぶ'); practice.href = songUrl(song, 'game', 'test'); actions.append(practice); }
    body.append(actions); card.append(artwork, body); list.append(card);
  });
}
const params = new URLSearchParams(location.search), legacy = params.get('chart');
if (params.has('missing-song')) showNotice('指定された曲が見つかりませんでした。楽曲一覧から選び直してください。');
if (legacy === 'custom' || legacy === 'test' || legacy === 'bundled') {
  const song = findSong(params.get('song'));
  if (song) location.replace(songUrl(song, 'game', legacy === 'custom' ? true : legacy));
  else showNotice('指定された曲が見つかりませんでした。楽曲一覧から選び直してください。');
}
search.addEventListener('input', render, { signal: listeners.signal });
window.addEventListener('pageshow', render, { signal: listeners.signal });
render();
if (import.meta.hot) import.meta.hot.dispose(() => listeners.abort());
