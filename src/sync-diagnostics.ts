import './sync-diagnostics.css';
import { stateName, CLOCK_LIMITS } from './sync';
import { SyncTrace } from './sync-trace';
import type { SyncObservation, SyncTraceRow } from './sync-trace';

/** Opt-in with ?sync=1. No telemetry requests or persistent browser storage. */
export function createSyncDiagnostics(song: { id: string; videoId: string }) {
  const panel = document.createElement('details'); panel.className = 'sync-diagnostics'; panel.open = true;
  panel.innerHTML = `<summary>同期診断 <span>タップで折りたたむ</span></summary>
    <p>広告後のずれは「広告が終わった」「ずれを感じた」で時点を記録できます。開始直後の記録は、曲の最後に保存しても残ります。</p>
    <div class="sync-markers"><button type="button" data-marker="ad-ended">広告が終わった</button><button type="button" data-marker="noticed-drift">ずれを感じた</button></div><p class="sync-marker-status" role="status"></p>
    <dl></dl><button type="button" data-action="download">診断ログを保存</button>
    <p>APIは間欠更新されるため、差が出ること自体は正常です。実際の映像・音の出力遅延は、この数値だけでは測れません。</p>`;
  document.body.append(panel);
  panel.addEventListener('toggle',() => { panel.querySelector('summary span')!.textContent = panel.open ? 'タップで折りたたむ' : 'タップで開く'; });
  const list = panel.querySelector('dl')!;
  const fields = ['状態','API時刻','補間時刻','判定時刻','補間 − API','判定 − API','入力補正','曲とノーツの補正','API更新から','API時刻の進み／指定速度','補間の予測速度','FPS／最大フレーム間隔','長い処理の回数／最長','APIの動画長','APIの読込率','APIの動画ID','ノーツ音の起動／入力／再生／破棄'];
  const values = fields.map(name => {
    const term = document.createElement('dt'), value = document.createElement('dd'); term.textContent = name; value.textContent = '—';
    list.append(term,value); return value;
  });
  const trace = new SyncTrace();
  let latest:SyncTraceRow|null=null;
  const markers:{label:string;atMs:number;lastSample:SyncTraceRow|null}[]=[];
  const mark=(label:string)=>{
    markers.push({label,atMs:performance.now(),lastSample:latest?{...latest}:null});
    if(markers.length>64)markers.shift();
  };
  panel.querySelectorAll<HTMLButtonElement>('[data-marker]').forEach(button=>button.addEventListener('click',()=>{
    mark(button.dataset.marker!);panel.querySelector('.sync-marker-status')!.textContent=`「${button.textContent}」の時点を記録しました。`;
  }));
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
      ms(row.clockLeadMs),ms(row.noteLeadMs),ms(row.inputOffsetMs),ms(row.noteOffsetMs ?? 0),`${row.apiUpdateAgeMs.toFixed(0)} ms`,
      `${row.observedRate === null ? '測定中' : row.observedRate.toFixed(2) + 'x'} / ${Number.isFinite(row.reportedRate) ? row.reportedRate.toFixed(2) + 'x' : '—'}`,
      `${row.predictionRate.toFixed(2)}x`,
      `${row.fps.toFixed(0)} / ${row.maxFrameGapMs.toFixed(0)} ms`,
      observer ? `${row.longTaskCount} / ${row.longestTaskMs.toFixed(0)} ms` : '未対応',
      row.videoDuration==null?'—':seconds(row.videoDuration),row.loadedFraction==null?'—':`${(row.loadedFraction*100).toFixed(0)}%`,row.reportedVideoId??'—',row.audio ? `${row.audio.state} / ${row.audio.requested}入力 / ${row.audio.started}再生 / ${row.audio.lateDrops}遅延破棄 / ${row.audio.blocked}未起動` : '—'];
    values.forEach((value,i) => { if (value.textContent !== text[i]) value.textContent = text[i]; });
  }
  const download = () => {
    const body = {schemaVersion:1,createdAt,exportedAt:new Date().toISOString(),...context,
      currentViewport:{width:innerWidth,height:innerHeight},samples:trace.snapshot(),startupSamples:trace.startupSnapshot(),events:trace.eventSnapshot(),markers};
    const url = URL.createObjectURL(new Blob([JSON.stringify(body,null,2)],{type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = `hey-rhythm-sync-${Date.now()}.json`;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url),1000);
  };
  panel.querySelector('[data-action="download"]')!.addEventListener('click',download);
  return {
    mark,
    record(sample: Omit<SyncObservation,'longTaskCount'|'longestTaskMs'|'visibility'>) {
      const row = trace.record({...sample,longTaskCount,longestTaskMs,visibility:document.visibilityState});
      if(row)latest=row;
      if (row && panel.open) show(row);
    },
    destroy() { observer?.disconnect(); panel.remove(); },
  };
}
