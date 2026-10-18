import './song-timing-preview.css';
import { createYouTubePlayer } from './youtube';
import type { YouTubePlayer } from './youtube';
import { VideoClock, PLAYER_STATE } from './sync';
import { TIMING_REFERENCE, drawTimingReference } from './timing-reference';

export function createSongTimingPreview(callbacks: {
  pause(): void;
  settings(): {noteOffset:number};
  apply(noteOffset:number,checked:boolean): void;
}) {
  const dialog=document.createElement('dialog');dialog.className='song-timing-preview';
  dialog.setAttribute('aria-labelledby','song-timing-title');
  dialog.innerHTML=`<h2 id="song-timing-title" tabindex="-1" autofocus>① 動画とノーツを合わせる</h2>
    <p class="song-timing-instructions">動画の丸が光り「カッ」と鳴る瞬間に、同じ番号のノーツが横線へ重なり、横線も同時に光ればOK。ノーツが早いなら＋、遅いなら−。押さずに見ながら調整します。</p>
    <div class="song-timing-transport"><button id="song-timing-start" type="button" disabled>再生して試す</button><button id="song-timing-back" type="button" disabled>最初から</button></div>
    <div class="song-timing-media"><div class="video-frame"></div><p class="field-help">専用動画：準備の3拍 → 6秒から1秒ごとに10回の合図</p></div>
    <div class="song-timing-field"><canvas aria-label="動画の合図1から10に対応する、番号付きの調整用ノーツ"></canvas></div>
    <div class="song-timing-controls">
      <label for="song-timing-offset">曲・動画に対するノーツ位置 <output id="song-timing-offset-value"></output></label>
      <div class="song-timing-range"><button type="button" data-adjust="-5" aria-label="ノーツを5ミリ秒早める">早める −5</button><input id="song-timing-offset" type="range" min="-300" max="300" step="5" /><button type="button" data-adjust="5" aria-label="ノーツを5ミリ秒遅らせる">遅らせる ＋5</button></div>
      <div class="song-timing-actions"><button id="song-timing-apply" type="button">補正を保存</button><button id="song-timing-close" type="button">キャンセル</button></div>
      <p id="song-timing-status" class="field-help" role="status"></p>
      <details class="song-timing-help"><summary>どちらを調整する？</summary><p class="field-help">動画の合図よりノーツが先に横線へ届く → ＋で遅らせる。あとに届く → −で早める。数値は再生中にも変えられます。光と音そのものがずれる場合は、クリック音とノーツの一致を優先してください。</p><p class="field-help">保存した補正は本番の曲にも反映します。動画とノーツが合うのにタップ判定だけずれる場合は「② タップ判定を調整」を使ってください。タップ入力の補正値は、この画面では変更しません。押した後の効果音の遅れは、この補正では短縮できません。</p></details>
    </div>`;
  document.body.append(dialog);
  const find=<T extends HTMLElement=HTMLElement>(id:string)=>dialog.querySelector<T>(`#${id}`)!;
  const offset=find<HTMLInputElement>('song-timing-offset');
  const start=find<HTMLButtonElement>('song-timing-start'),back=find<HTMLButtonElement>('song-timing-back'),status=find('song-timing-status');
  const canvas=dialog.querySelector('canvas')!,container=dialog.querySelector('.video-frame')!;
  const events=new AbortController(),signal=events.signal,clock=new VideoClock();
  let player:YouTubePlayer|null=null,disposePlayer=()=>{},frame=0,returnFocus:HTMLElement|null=null;
  let checked = false;
  let seekTarget:number|null=null,seekDeadline=0,displayTime=0,resize:ResizeObserver|null=null;
  const signed=(n:number)=>`${n>0?'+':''}${n} ms`;
  function draw():void { drawTimingReference(canvas,displayTime,offset.valueAsNumber); }
  function changed():void { find('song-timing-offset-value').textContent=signed(offset.valueAsNumber);draw(); }
  function seek(time:number):void {
    if(!player)return;clock.reset();seekTarget=time;seekDeadline=performance.now()+5000;player.seekTo(time,true);
  }
  function tick():void {
    if(!dialog.open||!player)return;
    try {
      const sample=clock.sample(player.getCurrentTime(),player.getPlayerState(),performance.now(),player.getPlaybackRate());
      if(seekTarget!==null&&(Math.abs(sample.rawTime-seekTarget)<.5||performance.now()>seekDeadline))seekTarget=null;
      const playing=sample.playing&&seekTarget===null;
      if(playing&&sample.time>=6&&sample.time<16)checked=true;
      displayTime=sample.time;draw();
      const ended=player.getPlayerState()===PLAYER_STATE.ENDED;
      const text=sample.stale?'動画の時刻更新を待っています。':ended?'10回の合図が終了しました。「最初から」で再確認できます。':playing
        ? sample.time<6?'準備のカウントダウン。合図1は動画6秒です。':'同じ番号の光・音とノーツの到達を合わせてください。'
        :'動画は停止中です。数値の変更は「補正を保存」するまで確定しません。';
      if(status.textContent!==text)status.textContent=text;
      start.textContent=playing?'一時停止':'再生して試す';
    } catch { status.textContent='動画の時刻を取得できません。閉じて開き直してください。'; }
    frame=requestAnimationFrame(tick);
  }
  function play():void {
    if(!player)return;
    if(player.getPlayerState()===PLAYER_STATE.PLAYING){player.pauseVideo();return;}
    if(player.getPlayerState()===PLAYER_STATE.ENDED)seek(0);
    player.playVideo();
  }
  function cleanup():void {
    cancelAnimationFrame(frame);resize?.disconnect();resize=null;
    disposePlayer();disposePlayer=()=>{};player=null;container.replaceChildren();start.disabled=true;back.disabled=true;
  }
  offset.addEventListener('input',changed,{signal});
  dialog.querySelectorAll<HTMLButtonElement>('[data-adjust]').forEach(button=>button.addEventListener('click',()=>{
    offset.value=String(Math.max(-300,Math.min(300,offset.valueAsNumber+Number(button.dataset.adjust))));changed();
  },{signal}));
  start.addEventListener('click',play,{signal});
  back.addEventListener('click',()=>{seek(0);player?.playVideo();},{signal});
  find('song-timing-apply').addEventListener('click',()=>{callbacks.apply(offset.valueAsNumber,checked);dialog.close();},{signal});
  find('song-timing-close').addEventListener('click',()=>dialog.close(),{signal});
  dialog.addEventListener('close',()=>{cleanup();returnFocus?.focus({preventScroll:true});},{signal});
  dialog.addEventListener('cancel',cleanup,{signal});
  const interrupt=()=>{if(dialog.open)player?.pauseVideo();};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)interrupt();},{signal});
  window.addEventListener('blur',()=>{if(!container.contains(document.activeElement))interrupt();},{signal});
  return {
    get active(){return dialog.open;},
    open(){
      if(dialog.open)return;returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
      callbacks.pause();checked=false;offset.value=String(callbacks.settings().noteOffset);seekTarget=null;displayTime=0;clock.reset();
      dialog.showModal();find('song-timing-title').focus({preventScroll:true});dialog.scrollTop=0;changed();
      resize=new ResizeObserver(draw);resize.observe(canvas);
      const mount=document.createElement('div');mount.id='song-timing-youtube';container.append(mount);
      status.textContent='調整用動画を準備しています…';
      disposePlayer=createYouTubePlayer({elementId:mount.id,title:'Hey! Rhythm! タイミング調整用動画',
        ready(instance){player=instance;player.setPlaybackRate(1);start.disabled=false;back.disabled=false;tick();},
        state(){},
        error(message){cancelAnimationFrame(frame);start.disabled=true;back.disabled=true;status.textContent=message;},
      },TIMING_REFERENCE);
    },
    destroy(){events.abort();cleanup();dialog.close();dialog.remove();},
  };
}
