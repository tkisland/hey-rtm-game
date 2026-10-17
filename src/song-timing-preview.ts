import './song-timing-preview.css';
import { createYouTubePlayer } from './youtube';
import type { YouTubePlayer } from './youtube';
import { VideoClock, PLAYER_STATE } from './sync';
import { Renderer } from './renderer';
import { GameEngine } from './engine';
import type { Chart } from './chart';
import type { Song } from './songs';
import { TapSound } from './sound';
import { NOTE_TRAVEL_SECONDS } from './settings';
import { SongSoundTimeline } from './song-timing';

export function createSongTimingPreview(callbacks: {
  song: Song; chart(): Chart; pause(): void;
  settings(): {inputOffset:number;visualOffset:number;soundVolume:number};
  apply(inputOffset:number,visualOffset:number): void;
}) {
  const dialog=document.createElement('dialog');dialog.className='song-timing-preview';
  dialog.setAttribute('aria-labelledby','song-timing-title');
  dialog.innerHTML=`<h2 id="song-timing-title" tabindex="-1" autofocus>曲・動画に合わせて調整</h2>
    <p class="song-timing-instructions">MVと自動のノーツ音を聴き比べ、音と見た目を合わせます。＋で遅く、−で早く。</p>
    <div class="song-timing-transport"><button id="song-timing-start" type="button" disabled>再生して試す</button><button id="song-timing-back" type="button" disabled>10秒戻す</button></div>
    <div class="song-timing-media"><div class="video-frame"></div><p class="field-help">${callbacks.song.title}</p></div>
    <div class="song-timing-field"><canvas aria-label="実際の譜面でタイミングを確認"></canvas></div>
    <div class="song-timing-controls">
      <label for="song-timing-offset">ノーツ音・判定のタイミング <output id="song-timing-offset-value"></output></label>
      <div class="song-timing-range"><button type="button" data-adjust="offset:-5" aria-label="ノーツ音を5ミリ秒早める">−5</button><input id="song-timing-offset" type="range" min="-300" max="300" step="5" /><button type="button" data-adjust="offset:5" aria-label="ノーツ音を5ミリ秒遅らせる">＋5</button></div>
      <label for="song-timing-visual">ノーツの見た目のタイミング <output id="song-timing-visual-value"></output></label>
      <div class="song-timing-range"><button type="button" data-adjust="visual:-5" aria-label="ノーツの見た目を5ミリ秒早める">−5</button><input id="song-timing-visual" type="range" min="-300" max="300" step="5" /><button type="button" data-adjust="visual:5" aria-label="ノーツの見た目を5ミリ秒遅らせる">＋5</button></div>
      <label for="song-timing-volume">試聴するノーツ音の音量</label><input id="song-timing-volume" type="range" min="0" max="100" step="5" />
      <div class="song-timing-actions"><button id="song-timing-apply" type="button">適用</button><button id="song-timing-close" type="button">キャンセル</button></div>
      <p id="song-timing-status" class="field-help" role="status"></p>
      <details class="song-timing-help"><summary>調整のヒント</summary><p class="field-help">音が曲より早いときは「ノーツ音・判定」を＋へ、遅いときは−へ。ノーツが横線へ早く届くときは「見た目」を＋へ、遅いときは−へ。見た目の調整は音・判定を変えません。</p><p class="field-help">押した後のノーツ音は即時再生のままです。MVの音声自体は変更しません。試聴音量はこの画面だけの設定です。</p></details>
    </div>`;
  document.body.append(dialog);
  const find=<T extends HTMLElement=HTMLElement>(id:string)=>dialog.querySelector<T>(`#${id}`)!;
  const offset=find<HTMLInputElement>('song-timing-offset'),visual=find<HTMLInputElement>('song-timing-visual'),volume=find<HTMLInputElement>('song-timing-volume');
  const start=find<HTMLButtonElement>('song-timing-start'),back=find<HTMLButtonElement>('song-timing-back'),status=find('song-timing-status');
  const canvas=dialog.querySelector('canvas')!,container=dialog.querySelector('.video-frame')!;
  const events=new AbortController(),signal=events.signal,clock=new VideoClock();
  let player:YouTubePlayer|null=null,disposePlayer=()=>{},sound:TapSound|null=null,renderer:Renderer|null=null;
  let notes:GameEngine|null=null,timeline:SongSoundTimeline|null=null,frame=0,returnFocus:HTMLElement|null=null;
  let generation=0,seekTarget:number|null=null,seekDeadline=0;
  const session=(navigator as Navigator & {audioSession?:{type:string}}).audioSession;
  let previousSession:string|null=null;
  const signed=(n:number)=>`${n>0?'+':''}${n} ms`;
  function changed():void {
    find('song-timing-offset-value').textContent=signed(offset.valueAsNumber);
    find('song-timing-visual-value').textContent=signed(visual.valueAsNumber);
  }
  function stopSound():void { sound?.setPlaybackActive(false);sound?.cancelPending();timeline?.reset(); }
  function seek(time:number):void {
    if(!player)return;stopSound();clock.reset();seekTarget=Math.max(0,time);seekDeadline=performance.now()+5000;player.seekTo(seekTarget,true);
  }
  function tick(now:number):void {
    if(!dialog.open||!player||!notes||!renderer)return;
    try {
      const sample=clock.sample(player.getCurrentTime(),player.getPlayerState(),performance.now(),player.getPlaybackRate());
      if(seekTarget!==null&&(Math.abs(sample.rawTime-seekTarget)<.5||performance.now()>seekDeadline))seekTarget=null;
      const playing=sample.playing&&seekTarget===null;
      sound?.setPlaybackActive(playing);
      if(!playing||sample.seek) sound?.cancelPending();
      const time=sample.time-offset.valueAsNumber/1000;
      for(const lane of timeline!.advance(time,playing,sample.seek)) { sound?.play(lane);renderer.flash(lane,now,'PERFECT'); }
      renderer.draw(notes.notes,sample.time,NOTE_TRAVEL_SECONDS,now,{inputOffsetMs:visual.valueAsNumber,playing,chart:notes.chart});
      const text=sample.stale?'動画の時刻更新を待っています。':player.getPlayerState()===PLAYER_STATE.ENDED?'再生終了。動画を戻してもう一度確認できます。':playing?'ノーツ音を自動再生中。2つの補正をその場で調整できます。':'動画とノーツ音は停止中です。';
      if(status.textContent!==text)status.textContent=text;
      start.textContent=playing?(sound?'一時停止':'ノーツ音も鳴らす'):'再生して試す';
    } catch { stopSound();status.textContent='動画の時刻を取得できません。閉じて開き直してください。'; }
    frame=requestAnimationFrame(tick);
  }
  async function play():Promise<void> {
    if(!player)return;
    if(player.getPlayerState()===PLAYER_STATE.PLAYING&&sound){player.pauseVideo();stopSound();return;}
    const current=generation;
    if(session&&previousSession===null) { try { const previous=session.type;session.type='playback';previousSession=previous; } catch { /* Optional iOS API. */ } }
    sound??=new TapSound(()=>{status.textContent='ノーツ音を再生できません。端末の音量を確認してください。';});
    sound.enabled=true;sound.volume=volume.valueAsNumber;sound.delay=0;sound.setPlaybackActive(true);
    const ready=await sound.unlock();if(current!==generation||!dialog.open)return;
    if(!ready){status.textContent='ノーツ音を再生できません。もう一度再生を押してください。';return;}
    player.playVideo();
  }
  function cleanup():void {
    generation++;cancelAnimationFrame(frame);stopSound();sound?.destroy();sound=null;
    disposePlayer();disposePlayer=()=>{};player=null;renderer?.destroy();renderer=null;
    notes=null;timeline=null;container.replaceChildren();start.disabled=true;back.disabled=true;
    if(session&&previousSession!==null) { try { if(session.type==='playback')session.type=previousSession; } catch { /* Optional iOS API. */ } previousSession=null; }
  }
  offset.addEventListener('input',changed,{signal});visual.addEventListener('input',changed,{signal});
  volume.addEventListener('input',()=>{if(sound)sound.volume=volume.valueAsNumber;},{signal});
  dialog.querySelectorAll<HTMLButtonElement>('[data-adjust]').forEach(button=>button.addEventListener('click',()=>{
    const [name,step]=button.dataset.adjust!.split(':'),control=name==='offset'?offset:visual;
    control.value=String(Math.max(-300,Math.min(300,control.valueAsNumber+Number(step))));changed();
  },{signal}));
  start.addEventListener('click',()=>void play(),{signal});
  back.addEventListener('click',()=>{if(player)seek(player.getCurrentTime()-10);},{signal});
  find('song-timing-apply').addEventListener('click',()=>{callbacks.apply(offset.valueAsNumber,visual.valueAsNumber);dialog.close();},{signal});
  find('song-timing-close').addEventListener('click',()=>dialog.close(),{signal});
  dialog.addEventListener('close',()=>{cleanup();returnFocus?.focus({preventScroll:true});},{signal});
  dialog.addEventListener('cancel',cleanup,{signal});
  const interrupt=()=>{if(dialog.open){player?.pauseVideo();stopSound();}};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)interrupt();},{signal});
  window.addEventListener('blur',()=>{if(!container.contains(document.activeElement))interrupt();},{signal});
  return {
    get active(){return dialog.open;},
    open(){
      if(dialog.open)return;returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
      callbacks.pause();const settings=callbacks.settings();offset.value=String(settings.inputOffset);visual.value=String(settings.visualOffset);
      volume.value=String(settings.soundVolume||70);changed();seekTarget=null;clock.reset();
      notes=new GameEngine(callbacks.chart());timeline=new SongSoundTimeline(callbacks.chart());
      dialog.showModal();find('song-timing-title').focus({preventScroll:true});dialog.scrollTop=0;renderer=new Renderer(canvas);
      const mount=document.createElement('div');mount.id='song-timing-youtube';container.append(mount);
      status.textContent='動画を準備しています…';
      disposePlayer=createYouTubePlayer({elementId:mount.id,
        ready(instance){player=instance;player.setPlaybackRate(1);start.disabled=false;back.disabled=false;status.textContent='再生して、曲とノーツ音を聴き比べてください。';tick(performance.now());},
        state(state){if(state!==PLAYER_STATE.PLAYING)stopSound();},
        error(message){cancelAnimationFrame(frame);stopSound();start.disabled=true;status.textContent=message;},
      },callbacks.song);
    },
    destroy(){events.abort();cleanup();dialog.close();dialog.remove();},
  };
}
