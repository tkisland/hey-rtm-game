import './onboarding.css';
import {loadOnboarding,subscribeOnboarding,updateOnboarding} from './onboarding-state';

export function mountOnboarding(actions: {tutorial():void;timing():void}): () => void {
  const banner=document.createElement('aside');banner.className='onboarding-reminder';banner.id='onboarding-reminder';
  banner.innerHTML=`<div><strong>はじめての準備</strong><p id="onboarding-summary"></p></div><button id="onboarding-resume" type="button">確認を続ける</button>`;
  document.querySelector('.library-toolbar')!.before(banner);
  const ready=document.createElement('p');ready.className='onboarding-ready';ready.hidden=true;ready.setAttribute('role','status');
  ready.textContent='準備OK！曲を選んで遊ぼう。';banner.after(ready);
  const dialog=document.createElement('dialog');dialog.id='onboarding';dialog.className='onboarding-dialog';
  dialog.setAttribute('aria-labelledby','onboarding-title');dialog.setAttribute('aria-describedby','onboarding-description');
  dialog.innerHTML=`<h2 id="onboarding-title" tabindex="-1">はじめてのLIVEの前に</h2>
    <p id="onboarding-description">遊び方を試して、音とノーツのタイミングを確認しよう！</p>
    <ol class="onboarding-steps">
      <li><button id="onboarding-tutorial" type="button">① 遊び方を体験する</button><span id="onboarding-tutorial-status"></span><p>6つの練習で、レスの受け止め方を試そう。成功数は問いません。</p></li>
      <li><button id="onboarding-timing" type="button">② タイミングをチェックする</button><span id="onboarding-timing-status"></span><p>専用動画の光・音とノーツを合わせよう。ずれていなければ、そのまま保存でOK。</p></li>
    </ol>
    <p id="onboarding-storage" class="field-help">確認済みの項目は、このブラウザに保存されます。順番は自由です。</p>
    <button id="onboarding-later" class="text-button" type="button">あとで確認する</button>`;
  document.body.append(dialog);
  const find=(id:string)=>document.getElementById(id)!;
  const resume=find('onboarding-resume');
  let state=loadOnboarding(),leavingToStep=false;
  function reflect():void {
    banner.hidden=state.tutorial&&state.timing;
    find('onboarding-summary').textContent=`遊び方 ${state.tutorial?'✓ 確認済み':'未確認'} ／ タイミング ${state.timing?'✓ 確認済み':'未確認'}`;
    find('onboarding-tutorial-status').textContent=state.tutorial?'✓ 確認済み':'未確認';
    find('onboarding-timing-status').textContent=state.timing?'✓ 確認済み':'未確認';
    find('onboarding-tutorial-status').classList.toggle('confirmed',state.tutorial);
    find('onboarding-timing-status').classList.toggle('confirmed',state.timing);
  }
  const unsubscribe=subscribeOnboarding((next,saved)=>{
    const wasReady=state.tutorial&&state.timing;state=next;reflect();
    if(!wasReady&&state.tutorial&&state.timing) { ready.hidden=false; if(!saved)ready.textContent='準備OK！曲を選んで遊ぼう。確認状況は今回の画面のみで保持します。'; }
    if(!saved)find('onboarding-storage').textContent='確認状況を保存できません。この画面では続けられますが、次回も案内が出る場合があります。';
  });
  function open():void {
    if(dialog.open)return;
    reflect();dialog.showModal();find('onboarding-title').focus({preventScroll:true});dialog.scrollTop=0;
  }
  const events=new AbortController(),signal=events.signal;
  function start(action:()=>void):void { leavingToStep=true;dialog.close();action(); }
  find('onboarding-tutorial').addEventListener('click',()=>start(actions.tutorial),{signal});
  find('onboarding-timing').addEventListener('click',()=>start(actions.timing),{signal});
  find('onboarding-later').addEventListener('click',()=>dialog.close(),{signal});
  resume.addEventListener('click',open,{signal});
  dialog.addEventListener('close',()=>{if(!leavingToStep&&!banner.hidden)resume.focus({preventScroll:true});leavingToStep=false;},{signal});
  function synchronize():void {
    const wasReady=state.tutorial&&state.timing;
    state=loadOnboarding();reflect();
    if(!wasReady&&state.tutorial&&state.timing)ready.hidden=false;
  }
  window.addEventListener('pageshow',synchronize,{signal});
  window.addEventListener('storage',synchronize,{signal});
  reflect();
  if(!state.seen&&!(state.tutorial&&state.timing)) { updateOnboarding({seen:true});open(); }
  return ()=>{unsubscribe();events.abort();dialog.close();dialog.remove();banner.remove();ready.remove();};
}
