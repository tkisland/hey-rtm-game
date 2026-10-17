import './sync-diagnostics.css';
import { stateName, CLOCK_LIMITS } from './sync';
import { SyncTrace } from './sync-trace';
import type { SyncObservation, SyncTraceRow } from './sync-trace';

/** Opt-in with ?sync=1. No telemetry requests or persistent browser storage. */
export function createSyncDiagnostics(song: { id: string; videoId: string }) {
  const panel = document.createElement('details'); panel.className = 'sync-diagnostics'; panel.open = true;
  panel.innerHTML = `<summary>同期診断 <span>タップで折りたたむ</span></summary>
    <p>ずれが出たら「診断ログを保存」を押してください。ログは端末内に記録し、自動送信しません。</p>
    <dl></dl><button type="button">診断ログを保存</button>
    <p>APIは間欠更新されるため、差が出ること自体は正常です。実際の映像・音の出力遅延は、この数値だけでは測れません。</p>`;
  document.body.append(panel);
  panel.addEventListener('toggle',() => { panel.querySelector('summary span')!.textContent = panel.open ? 'タップで折りたたむ' : 'タップで開く'; });
  const list = panel.querySelector('dl')!;
  const fields = ['状態','API時刻','補間時刻','判定時刻','補間 − API','判定 − API','入力補正','API更新から','API時刻の進み／指定速度','補間の予測速度','FPS／最大フレーム間隔','長い処理の回数／最長'];
  const values = fields.map(name => {
    const term = document.createElement('dt'), value = document.createElement('dd'); term.textContent = name; value.textContent = '—';
    list.append(term,value); return value;
  });
  const trace = new SyncTrace();
  const createdAt = new Date().toISOString();
  const context = { song: {id:song.id,videoId:song.videoId}, userAgent:navigator.userAgent,
    language:navigator.language, hardwareConcurrency:navigator.hardwareConcurrency, devicePixelRatio:window.devicePixelRatio,
    initialViewport:{width:innerWidth,height:innerHeight}, clockLimits:{...CLOCK_LIMITS} };
  let observer: PerformanceObserver | null = null, longTaskCount = 0, longestTaskMs = 0;
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    try {
      observer = new PerformanceObserver(entries => {
        for (const entry of entries.getEntries()) { longTaskCount++; longestTaskMs = Math.max(longestTaskMs,entry.duration); }
      });
      observer.observe({type:'longtask'});
    } catch { observer?.disconnect(); observer = null; }
  }
  const seconds = (n: number) => Number.isFinite(n) ? `${n.toFixed(3)} s` : '—';
  const ms = (n: number) => Number.isFinite(n) ? `${n > 0 ? '+' : ''}${n.toFixed(0)} ms` : '—';
  function show(row: SyncTraceRow): void {
    const text = [stateName(row.playerState) + (row.stale ? ' · 更新待ち' : ''),seconds(row.apiTime),seconds(row.clockTime),seconds(row.judgementTime),
      ms(row.clockLeadMs),ms(row.noteLeadMs),ms(row.inputOffsetMs),`${row.apiUpdateAgeMs.toFixed(0)} ms`,
      `${row.observedRate === null ? '測定中' : row.observedRate.toFixed(2) + 'x'} / ${Number.isFinite(row.reportedRate) ? row.reportedRate.toFixed(2) + 'x' : '—'}`,
      `${row.predictionRate.toFixed(2)}x`,
      `${row.fps.toFixed(0)} / ${row.maxFrameGapMs.toFixed(0)} ms`,
      observer ? `${row.longTaskCount} / ${row.longestTaskMs.toFixed(0)} ms` : '未対応'];
    values.forEach((value,i) => { if (value.textContent !== text[i]) value.textContent = text[i]; });
  }
  const download = () => {
    const body = {schemaVersion:1,createdAt,exportedAt:new Date().toISOString(),...context,
      currentViewport:{width:innerWidth,height:innerHeight},samples:trace.snapshot()};
    const url = URL.createObjectURL(new Blob([JSON.stringify(body,null,2)],{type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = `hey-rhythm-sync-${Date.now()}.json`;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url),1000);
  };
  panel.querySelector('button')!.addEventListener('click',download);
  return {
    record(sample: Omit<SyncObservation,'longTaskCount'|'longestTaskMs'|'visibility'>) {
      const row = trace.record({...sample,longTaskCount,longestTaskMs,visibility:document.visibilityState});
      if (row && panel.open) show(row);
    },
    destroy() { observer?.disconnect(); panel.remove(); },
  };
}
