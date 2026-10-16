import './style.css';
import './admin.css';
import { cloudConfig } from './cloud-config';
import { loginWithGoogle, logout, watchAdminAccess } from './cloud-auth';
import type { AccessState } from './cloud-auth';
import type { User } from 'firebase/auth';
import { publishDraft, readDraft, saveDraft } from './cloud-store';
import { chartJson } from './cloud-schema';
import type { CloudChart } from './cloud-schema';
import { bundledChart } from './bundled-charts';
import { emptyChart } from './editor-model';
import type { Chart } from './chart';
import { findSong, SONGS, songUrl } from './songs';
import type { Song } from './songs';
import type { EditorHandle } from './editor-controller';
import { playableNotes } from './note-display';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const initialApp = el('app').outerHTML, login = el<HTMLButtonElement>('google-login');
const tools = el('admin-tools'), status = el('cloud-status'), save = el<HTMLButtonElement>('cloud-save'), publish = el<HTMLButtonElement>('cloud-publish');
const songSelect = el<HTMLSelectElement>('admin-song');
for (const song of SONGS) { const option = document.createElement('option'); option.value = song.id; option.textContent = song.title; songSelect.append(option); }
let song = findSong(new URLSearchParams(location.search).get('song')) ?? SONGS[0];
let user: User | null = null, editor: EditorHandle | null = null, saved: CloudChart | null = null;
let revision = 0, dirty = false, busy = false, allowed = false, generation = 0;
const listeners = new AbortController(), signal = listeners.signal;
function controls(): void { save.disabled = publish.disabled = busy || !allowed || !editor; songSelect.disabled = busy || !allowed; }
function clearEditor(): void {
  generation++; editor?.dispose(); editor = null; saved = null; revision = 0; dirty = false; tools.hidden = true;
  document.body.classList.remove('editor-page');
  if (!document.getElementById('google-login')) el('app').outerHTML = initialApp;
}
function errorText(error: unknown): string {
  const code = (error as {code?:string})?.code;
  if (code === 'auth/popup-closed-by-user') return 'ログインをキャンセルしました。';
  if (code === 'auth/popup-blocked') return 'ログイン画面を開けませんでした。ポップアップを許可して、もう一度押してください。';
  if (code === 'auth/unauthorized-domain') return 'このサイトのログイン用ドメインが未登録です。管理者が接続設定を確認してください。';
  if (code === 'auth/operation-not-allowed') return 'Googleログインがまだ有効になっていません。管理者が接続設定を確認してください。';
  if (code === 'auth/internal-error') return 'ログイン画面に接続できませんでした。接続やブラウザの制限を確認し、もう一度お試しください。';
  if (code === 'permission-denied' || code === 'auth/user-disabled') return '保存する権限を確認できません。管理者としてログインし直してください。';
  if (code === 'unavailable' || code === 'auth/network-request-failed') return '接続できませんでした。変更は未保存です。接続を確認して再試行するか、JSONを書き出してください。';
  if (code) return '操作を完了できませんでした。ログインや保存先の設定を確認して再試行してください。';
  return error instanceof Error ? error.message : '操作を完了できませんでした。';
}
async function perform(action: () => Promise<void>): Promise<void> {
  if (busy || !allowed || !user || !editor) return;
  const current = generation; busy = true; controls(); editor.pause();
  try { await action(); } catch (error) { if (current === generation) status.textContent = errorText(error); }
  finally { busy = false; controls(); }
}
async function persist(chart: Chart): Promise<CloudChart> {
  const actor = user!, current = generation;
  const result = await saveDraft(song, actor, chart, revision);
  if (current !== generation || user?.uid !== actor.uid) throw new Error('ログイン状態が変わりました。');
  saved = result; revision = result.revision;
  dirty = chartJson(editor!.chart(), song) !== result.json;
  el('save-status').textContent = dirty ? '保存後の変更は未保存です。' : 'オンラインの下書きを保存しました。';
  status.textContent = `下書きを保存しました（版 ${revision}）。公開するまでプレーヤーの譜面は変わりません。`;
  return result;
}
async function openEditor(next: Song): Promise<void> {
  const actor = user!; clearEditor(); const current = generation; song = next;
  status.textContent = '下書きを読み込んでいます…';
  const draft = await readDraft(song, actor);
  const [{mountEditor}, template] = await Promise.all([import('./editor-controller'), import('./editor-template.html?raw')]);
  if (current !== generation || !allowed || user?.uid !== actor.uid) return;
  const parsed = new DOMParser().parseFromString(template.default, 'text/html'), app = parsed.getElementById('app')!;
  app.querySelector('.admin-notice')!.textContent = '管理者専用の編集画面です。下書きを保存してから公開できます。';
  el('app').replaceWith(document.importNode(app, true)); document.body.classList.add('editor-page');
  const chart = draft?.chart ?? bundledChart(song) ?? emptyChart(song);
  saved = draft; revision = draft?.revision ?? 0; dirty = false; songSelect.value = song.id; tools.hidden = false;
  editor = mountEditor({song, initialChart:chart, online:true,
    onChange() { dirty = true; status.textContent = '未保存の変更があります。'; },
    async preview(chart) { await perform(async () => { await persist(chart); location.href = `${songUrl(song, 'game')}&preview=1`; }); },
  });
  el('try-game').textContent = '保存してゲームで試す';
  el('save-status').textContent = draft ? 'オンラインの下書きを読み込みました。' : '収録譜面を読み込みました。編集後に下書きを保存してください。';
  status.textContent = draft ? `下書きの版 ${revision} を読み込みました。` : '公開中の譜面を基に編集できます。';
  const url = new URL(location.href); url.searchParams.set('song', song.id); history.replaceState(null, '', url);
  controls();
}
async function access(state: AccessState): Promise<void> {
  if (state.phase === 'checking' && editor && user?.uid === state.user?.uid) {
    allowed = false; controls(); status.textContent = '管理者権限・接続を確認しています。変更はまだ公開されていません。'; return;
  }
  const same = user?.uid === state.user?.uid;
  user = state.user; allowed = state.phase === 'allowed';
  el('admin-session').hidden = !user;
  el('admin-account').textContent = user?.email ?? '';
  if (allowed && user) {
    if (editor && same) { controls(); status.textContent = dirty ? '未保存の変更があります。' : `下書きの版 ${revision} を編集中です。`; return; }
    try { await openEditor(song); } catch (error) { status.textContent = errorText(error); }
    return;
  }
  clearEditor(); controls();
  const button = el<HTMLButtonElement>('google-login'); button.disabled = state.phase === 'checking';
  const labels = {out:'Googleでログインしてください。', checking:'管理者権限を確認しています…', denied:'このアカウントには編集権限がありません。登録済みの管理者アカウントを選んでください。', error:'ログイン状態を確認できませんでした。接続を確認してページを開き直してください。', allowed:''};
  el('login-status').textContent = labels[state.phase];
  el('admin-account-id').hidden = !user || state.phase !== 'denied';
  el('admin-account-id').textContent = user ? `アカウントID：${user.uid}` : '';
}
document.addEventListener('click', event => {
  if (!(event.target as Element).closest('#google-login')) return;
  const button = el<HTMLButtonElement>('google-login'); button.disabled = true;
  void loginWithGoogle().catch(error => { el('login-status').textContent = errorText(error); }).finally(() => { if (document.getElementById('google-login')) el<HTMLButtonElement>('google-login').disabled = false; });
}, {signal});
el('admin-logout').addEventListener('click', () => {
  if (dirty && !confirm('未保存の変更があります。ログアウトしますか？ 必要なら先にJSONを書き出してください。')) return;
  void logout().then(() => location.replace('./admin.html')).catch(error => { status.textContent = errorText(error); });
}, {signal});
save.addEventListener('click', () => void perform(async () => { await persist(editor!.chart()); }), {signal});
publish.addEventListener('click', () => void perform(async () => {
  const chart = editor!.chart(); chartJson(chart, song, true);
  if (!confirm(`「${song.title}」の${playableNotes(chart.notes).length}ノーツを公開します。公開後はプレーヤーが新しい譜面で遊びます。よろしいですか？`)) return;
  const current = generation, actor = user!;
  const snapshot = dirty || !saved ? await persist(chart) : saved;
  const release = await publishDraft(song, actor, snapshot);
  if (current === generation) status.textContent = `公開しました（公開版 ${release}）。選曲から新しい譜面で遊べます。`;
}), {signal});
songSelect.addEventListener('change', () => {
  const next = findSong(songSelect.value);
  if (!next || (dirty && !confirm('未保存の変更があります。保存せずに曲を切り替えますか？'))) { songSelect.value = song.id; return; }
  void openEditor(next).catch(error => { status.textContent = errorText(error); });
}, {signal});
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }, {signal});
let stopAccess = () => {};
if (!cloudConfig) { login.disabled = true; el('login-status').textContent = '管理者ログインは準備中です。設定が完了するとGoogleでログインできます。'; }
else stopAccess = watchAdminAccess(state => void access(state));
if (import.meta.hot) import.meta.hot.dispose(() => { stopAccess(); clearEditor(); listeners.abort(); });
