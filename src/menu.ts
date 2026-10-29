import './style.css';
import './menu.css';
import { LANE_COLORS } from './colors';
import { CUSTOM_CHART_KEY, EDITOR_KEY, loadChart, storeChart } from './editor-model';
import { findSong, isPublicDifficulty, SONGS, songStorageKey, songUrl } from './songs';
import type { Song } from './songs';
import { bundledChart } from './bundled-charts';
import { tempoLabel } from './tempo';
import { publishedChart } from './cloud-published';
import type { Chart } from './chart';
import { mountTutorial } from './tutorial';
import { playableNotes } from './note-display';
import {mountOnboarding} from './onboarding';
import {loadOnboarding,updateOnboarding} from './onboarding-state';
import { mountMenuSettings } from './menu-settings';
import {DIFFICULTIES,DEFAULT_DIFFICULTY,findDifficulty} from './difficulties';
import type {Difficulty} from './difficulties';

const list = document.getElementById('song-list')!;
const search = document.getElementById('song-search') as HTMLInputElement;
const notice = document.getElementById('menu-notice')!;
const listeners = new AbortController();
const menuSettings = mountMenuSettings();
const disposeTutorial = mountTutorial(__ADMIN__ ? {} : {
  onComplete() { if(!loadOnboarding().tutorial)updateOnboarding({tutorial:true}); },
  continueLabel: () => loadOnboarding().timing ? '選曲に戻る' : 'タイミングをチェック',
  onContinue() { if(!loadOnboarding().timing)menuSettings.openTiming(); },
});
const disposeOnboarding = __ADMIN__ ? () => {} : mountOnboarding({
  tutorial() { document.getElementById('open-tutorial')!.click(); },
  timing() { menuSettings.openTiming(); },
});
const online = new Map<string, Chart>();
const selected = new Map<string,Difficulty>();
const chartKey = (song:Song,difficulty:Difficulty) => `${song.id}:${difficulty}`;
const savedChart = (song: Song,difficulty:Difficulty) => loadChart(songStorageKey(EDITOR_KEY, song,difficulty), true, song) ?? loadChart(songStorageKey(CUSTOM_CHART_KEY, song,difficulty), true, song);
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
}
function showNotice(text: string): void { notice.textContent = text; notice.hidden = false; }
function render(): void {
  const focused = document.activeElement instanceof HTMLSelectElement ? document.activeElement.id : null;
  const query = search.value.trim().toLocaleLowerCase();
  const songs = SONGS.filter(song => `${song.title} ${song.artist}`.toLocaleLowerCase().includes(query));
  list.replaceChildren();
  document.getElementById('song-count')!.textContent = `${songs.length}曲 / 全${SONGS.length}曲`;
  document.getElementById('song-empty')!.hidden = songs.length > 0;
  songs.forEach(song => {
    const difficulty=selected.get(song.id) ?? DEFAULT_DIFFICULTY;
    const saved = __ADMIN__ ? savedChart(song,difficulty) : null, bundled = (__ADMIN__ || isPublicDifficulty(song,difficulty)) ? online.get(chartKey(song,difficulty)) ?? bundledChart(song,difficulty) : null, card = node('article', 'song-card'); card.dataset.song = song.id;
    const artwork = node('div', 'song-art'); artwork.setAttribute('aria-hidden', 'true');
    artwork.append(node('span', 'cover-number', String(SONGS.indexOf(song) + 1).padStart(2, '0')));
    const lanes = node('div', 'cover-lanes');
    for (const color of LANE_COLORS) { const lane = node('i', ''); lane.style.setProperty('--color', color); lanes.append(lane); }
    artwork.append(lanes);
    const body = node('div', 'song-card-body');
    body.append(node('p', 'song-artist', song.artist), node('h2', 'song-name', song.title), node('p', 'song-meta', bundled ? `6 LANES · ${__ADMIN__ ? `${(song.charts?.[difficulty] ?? song.chartId)?.toUpperCase()} · ` : ''}${tempoLabel(bundled)} BPM · ${playableNotes(bundled.notes).length} NOTES` : __ADMIN__ ? `6 LANES · 練習譜面 ${song.bpm} BPM` : '譜面の準備中'));
    const levelLabel=node('label','difficulty-choice'), level=node('select','song-difficulty');level.id=`difficulty-${song.id}`;
    level.setAttribute('aria-label',`${song.title}の難易度`);
    for(const item of DIFFICULTIES){
      const available=isPublicDifficulty(song,item.id) && (online.has(chartKey(song,item.id)) || !!bundledChart(song,item.id));
      const option=node('option','',`${item.label}${available || __ADMIN__ ? '' : '（準備中）'}`);option.value=item.id;level.append(option);
    }
    level.value=difficulty;
    level.addEventListener('change',()=>{const next=findDifficulty(level.value);if(next){selected.set(song.id,next);render();}});
    levelLabel.append(level);
    if (__ADMIN__) body.append(node('p', 'saved-summary', saved ? `保存譜面あり · ${playableNotes(saved.notes).length} NOTES` : '管理者の下書きはまだありません。編集から作成できます。'));
    const actions = node('div', 'song-actions');
    if(!__ADMIN__)actions.classList.add('player-difficulty-actions');
    actions.append(levelLabel);
    if (bundled || __ADMIN__) {
      const play = node('a', 'song-play', __ADMIN__ ? bundled ? '収録譜面で遊ぶ' : '練習譜面で遊ぶ' : 'プレイ');
      play.href = __ADMIN__ ? songUrl(song, 'game', bundled ? 'bundled' : 'test',difficulty) : songUrl(song, 'game',false,difficulty);
      actions.append(play);
      if(!__ADMIN__){
        const demo=node('a','song-demo','見本プレイ');
        demo.href=`${songUrl(song,'game',false,difficulty)}&mode=demo`;actions.append(demo);
      }
    } else actions.append(node('span', 'song-unavailable', '準備中'));
    if (__ADMIN__) {
      const custom = node('button', 'song-saved', '保存譜面で遊ぶ'); custom.type = 'button'; custom.disabled = !saved;
      custom.addEventListener('click', () => {
        const latest = savedChart(song,difficulty);
        if (!latest) { showNotice('保存譜面を読み込めませんでした。「譜面を編集」から確認してください。'); render(); return; }
        if (!storeChart(songStorageKey(CUSTOM_CHART_KEY, song,difficulty), latest)) { showNotice('試遊用の譜面を保存できません。ブラウザの保存設定を確認するか、譜面エディターでJSONを書き出してください。'); return; }
        location.href = songUrl(song, 'game', true,difficulty);
      });
      const edit = node('a', 'song-edit', '譜面を編集 →'); edit.href = songUrl(song, 'editor',false,difficulty);
      actions.append(custom, edit);
      if (bundled) { const practice = node('a', 'song-practice', '練習譜面で遊ぶ'); practice.href = songUrl(song, 'game', 'test',difficulty); actions.append(practice); }
    }
    body.append(actions); card.append(artwork, body); list.append(card);
  });
  if(focused)document.getElementById(focused)?.focus({preventScroll:true});
}
const params = new URLSearchParams(location.search), legacy = params.get('chart');
if (params.has('missing-song')) showNotice('指定された曲が見つかりませんでした。楽曲一覧から選び直してください。');
if (params.has('missing-difficulty')) showNotice('指定された難易度が見つかりませんでした。難易度を選び直してください。');
if (params.has('unavailable-song')) showNotice('この曲の譜面は準備中です。ほかの曲を選んでください。');
if (legacy === 'custom' || legacy === 'test' || legacy === 'bundled') {
  const song = findSong(params.get('song'));
  const difficulty=findDifficulty(params.get('difficulty'));
  if (song && difficulty) location.replace(__ADMIN__ ? songUrl(song, 'game', legacy === 'custom' ? true : legacy,difficulty) : songUrl(song, 'game',false,difficulty));
  else showNotice('指定された曲が見つかりませんでした。楽曲一覧から選び直してください。');
}
search.addEventListener('input', render, { signal: listeners.signal });
window.addEventListener('pageshow', render, { signal: listeners.signal });
render();
if (!__ADMIN__) void Promise.all(SONGS.flatMap(song => DIFFICULTIES.map(async difficulty => {
  if(!isPublicDifficulty(song,difficulty.id))return;
  try { const published = await publishedChart(song,difficulty.id); if (published) online.set(chartKey(song,difficulty.id), published.chart); }
  catch { /* The game reports a failed chart request without playing stale data. */ }
}))).then(() => { if (!listeners.signal.aborted) render(); });
if (import.meta.hot) import.meta.hot.dispose(() => { listeners.abort(); disposeOnboarding(); disposeTutorial(); menuSettings.destroy(); });
