import { loadSettings, normalizePlayerSettings, saveSettings } from './settings';
import {updateOnboarding} from './onboarding-state';
import type { Settings } from './settings';
import { createSongTimingPreview } from './song-timing-preview';
import { createTimingPreview } from './timing-preview';

/** The same shared player preferences used by the game and tutorial. */
export function mountMenuSettings(): {openTiming():void;destroy():void} {
  const opener = document.getElementById('settings-toggle')!;
  const dialog = document.createElement('dialog');
  dialog.id = 'settings-panel'; dialog.className = 'menu-settings settings-panel';
  dialog.setAttribute('aria-labelledby','menu-settings-title');
  dialog.innerHTML = `
    <div class="menu-settings-heading"><h2 id="menu-settings-title">設定</h2><button id="settings-close" class="text-button" type="button">閉じる</button></div>
    <button id="song-calibrate" class="restart-button" type="button">① 動画とノーツを合わせる</button>
    <p class="field-help">ノーツが曲より早い・遅い → 専用動画の光・音と番号付きノーツを合わせます。まずはこちら。</p>
    <button id="flow-calibrate" class="restart-button" type="button">② タップ判定を調整</button>
    <p class="field-help">曲とノーツは合うのに判定が早い・遅い → 10ノーツで入力補正を測定。ノーツ位置は変えません。</p>
    <label for="travel">ノーツの表示時間 <output id="travel-value">2.5秒</output></label>
    <input id="travel" type="range" min="1" max="4" step="0.25" value="2.5" aria-describedby="travel-help" />
    <p id="travel-help" class="field-help">出現から判定ラインまでの時間です。長いほどゆっくり流れます。曲とのタイミングや判定の補正は変わりません。</p>
    <label for="sound-volume">ノーツ音の音量 <output id="sound-volume-value">70%</output></label>
    <input id="sound-volume" type="range" min="0" max="100" step="5" value="70" />
    <p class="field-help">タップ時や長オシ中のノーツ音の音量です。0%で消音になります。</p>
    <p id="storage-status" class="field-help" role="status">設定はゲームと遊び方にも反映されます。</p>`;
  document.body.append(dialog);
  const travel = dialog.querySelector<HTMLInputElement>('#travel')!;
  const travelValue = dialog.querySelector<HTMLOutputElement>('#travel-value')!;
  const volume = dialog.querySelector<HTMLInputElement>('#sound-volume')!;
  const value = dialog.querySelector<HTMLOutputElement>('#sound-volume-value')!;
  const status = dialog.querySelector<HTMLElement>('#storage-status')!;
  const read = () => __ADMIN__ ? loadSettings() : normalizePlayerSettings(loadSettings());
  let settings = read();
  const events = new AbortController(), signal = events.signal;
  const reflect = () => { travel.value = String(settings.travel); travelValue.value = `${settings.travel}秒`; volume.value = String(settings.soundVolume); value.value = `${settings.soundVolume}%`; };
  function save(change: Partial<Settings>): boolean {
    settings = { ...settings, ...change };
    const saved = saveSettings(settings);
    reflect();
    status.textContent = saved ? '設定を保存しました。' : 'ブラウザへの保存ができません。ブラウザの保存設定を確認してください。';
    return saved;
  }
  let guided = false;
  const songPreview = createSongTimingPreview({ pause() {}, settings: () => settings, apply(noteOffset,checked) {
    const saved = save({noteOffset});
    if (saved && checked) {
      updateOnboarding({timing:true});
      if (guided) queueMicrotask(() => dialog.close());
      guided = false;
    }
  } });
  const preview = createTimingPreview({ pause() {}, settings: () => settings, apply: inputOffset => save({inputOffset}) });
  function openSettings(): void {
    if (dialog.open) return;
    settings = read(); reflect();
    status.textContent = '設定はゲームと遊び方にも反映されます。';
    dialog.showModal(); opener.setAttribute('aria-expanded','true');
    dialog.querySelector<HTMLButtonElement>('#song-calibrate')!.focus();
  }
  opener.addEventListener('click', openSettings, {signal});
  dialog.querySelector('#settings-close')!.addEventListener('click', () => dialog.close(), {signal});
  dialog.addEventListener('close', () => { guided = false; opener.setAttribute('aria-expanded','false'); opener.focus(); }, {signal});
  dialog.querySelector('#flow-calibrate')!.addEventListener('click', () => preview.open(), {signal});
  dialog.querySelector('#song-calibrate')!.addEventListener('click', () => songPreview.open(), {signal});
  travel.addEventListener('input', () => save({travel:travel.valueAsNumber}), {signal});
  volume.addEventListener('input', () => save({sound:true,soundVolume:volume.valueAsNumber}), {signal});
  return {
    openTiming() { guided = true; openSettings(); songPreview.open(); },
    destroy() { events.abort(); preview.destroy(); songPreview.destroy(); dialog.close(); dialog.remove(); },
  };
}
