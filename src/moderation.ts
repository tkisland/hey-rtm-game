import './style.css';
import './admin.css';
import './moderation.css';
import {loginWithGoogle,logout,requireCloudAdmin,watchAdminAccess} from './cloud-auth';
import {SONGS} from './songs';
import {DIFFICULTIES} from './difficulties';

interface Entry {id:string;name:string;score:number;maxCombo:number;createdAt:number;hidden:boolean;revision:number;reason:string;actorUid:string;updatedAt:number;rulesVersion:number;chartHash:string}
interface History {hidden:boolean;revision:number;reason:string;actorUid:string;createdAt:number}
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)! as T;
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const value=document.createElement(tag);value.textContent=text;return value;};
const list=el<HTMLOListElement>('moderation-entries'),panel=el('moderation-panel'),status=el('moderation-status');
const song=el<HTMLSelectElement>('moderation-song'),level=el<HTMLSelectElement>('moderation-difficulty');
for(const item of SONGS){const option=node('option',item.title);option.value=item.id;song.append(option);}
for(const item of DIFFICULTIES){const option=node('option',item.label);option.value=item.id;level.append(option);}level.value='normal';
let allowed=false,generation=0,pageGeneration=0,next:string|null=null,cursors:(string|null)[]=[null];
const controller=new AbortController(),signal=controller.signal;
let rowsController=new AbortController();
const format=new Intl.NumberFormat('ja-JP'),date=(time:number)=>new Date(time*1000).toLocaleString('ja-JP');
async function request<T>(data:Record<string,unknown>):Promise<T>{
  const user=await requireCloudAdmin(),idToken=await user.getIdToken();
  const response=await fetch(new URL('./api/moderation.php',location.href),{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,idToken}),signal:AbortSignal.timeout(20000)});
  const result=await response.json();if(!response.ok||result.ok!==true)throw new Error(result.message ?? '操作を完了できません。');return result as T;
}
async function load():Promise<void>{
  if(!allowed)return;const current=++pageGeneration,access=generation;
  rowsController.abort();rowsController=new AbortController();const rowSignal=rowsController.signal;
  status.textContent='記録を読み込んでいます…';list.replaceChildren();next=null;el<HTMLButtonElement>('moderation-next').disabled=true;
  el<HTMLButtonElement>('moderation-previous').disabled=cursors.length===1;
  try{
    const data=await request<{entries:Entry[];nextCursor:string|null}>({action:'list',songId:song.value,difficulty:level.value,...(cursors.at(-1)?{cursor:cursors.at(-1)}:{})});
    if(!allowed||access!==generation||current!==pageGeneration)return;
    next=data.nextCursor;el<HTMLButtonElement>('moderation-next').disabled=!next;
    for(const entry of data.entries){
      const row=node('li');row.dataset.entry=entry.id;row.className=entry.hidden?'moderation-record is-hidden':'moderation-record';
      row.append(node('h2',`${entry.name} · ${entry.hidden?'非表示':'公開中'}`),node('p',`${format.format(entry.score)}点 / MAX COMBO ${entry.maxCombo}`),node('p',`ID ${entry.id} · ${date(entry.createdAt)} · ルール${entry.rulesVersion} · 譜面 ${entry.chartHash.slice(0,8)}`));
      if(entry.reason)row.append(node('p',`前回の理由：${entry.reason}（${entry.actorUid} / ${date(entry.updatedAt)}）`));
      const label=node('label','変更理由（必須・200文字まで）'),reason=node('input');reason.type='text';reason.maxLength=200;reason.setAttribute('aria-label',`記録${entry.id}の変更理由`);label.append(reason);
      const change=node('button',entry.hidden?'復元する':'非表示にする');change.type='button';change.className='restart-button';const message=node('p');message.setAttribute('role','status');
      change.addEventListener('click',()=>{
        if(!reason.value.trim()){message.textContent='変更理由を入力してください。';reason.focus();return;}
        change.disabled=true;message.textContent='権限を確認して更新しています…';
        void request({action:entry.hidden?'restore':'hide',entryId:entry.id,revision:entry.revision,reason:reason.value}).then(()=>{if(allowed&&access===generation)void load();}).catch(error=>{if(access===generation&&current===pageGeneration){message.textContent=error instanceof Error?error.message:'更新できません。';change.disabled=false;}});
      },{signal:rowSignal});
      const details=node('details'),history=node('ul');details.append(node('summary','変更履歴（最新20件）'),history);
      details.addEventListener('toggle',()=>{
        if(!details.open||history.childElementCount)return;history.append(node('li','読み込んでいます…'));
        void request<{history:History[]}>({action:'history',entryId:entry.id}).then(data=>{
          if(!allowed||access!==generation||current!==pageGeneration)return;
          history.replaceChildren(...data.history.map(item=>node('li',`${date(item.createdAt)} · ${item.hidden?'非表示':'復元'} · ${item.reason} · ${item.actorUid}`)));
          if(!data.history.length)history.append(node('li','変更履歴はありません。'));
        }).catch(()=>{if(access===generation)history.replaceChildren(node('li','履歴を取得できません。'))});
      },{signal:rowSignal});
      row.append(label,change,message,details);list.append(row);
    }
    status.textContent=data.entries.length?`${data.entries.length}件を表示しています。`:'記録はありません。';
  }catch(error){if(allowed&&access===generation&&current===pageGeneration)status.textContent=error instanceof Error?error.message:'取得できません。';}
}
const reset=()=>{cursors=[null];void load();};
song.addEventListener('change',reset,{signal});level.addEventListener('change',reset,{signal});el('moderation-refresh').addEventListener('click',reset,{signal});
el('moderation-next').addEventListener('click',()=>{if(next){cursors.push(next);void load();}},{signal});
el('moderation-previous').addEventListener('click',()=>{if(cursors.length>1){cursors.pop();void load();}},{signal});
el('google-login').addEventListener('click',()=>{void loginWithGoogle().catch(error=>{el('login-status').textContent=error instanceof Error?error.message:'ログインできません。';});},{signal});
el('moderation-logout').addEventListener('click',()=>{void logout().catch(()=>{el('login-status').textContent='ログアウトできませんでした。再試行してください。';});},{signal});
const stop=watchAdminAccess(state=>{
  rowsController.abort();generation++;allowed=state.phase==='allowed';panel.hidden=!allowed;list.replaceChildren();
  el('moderation-account').textContent=state.user?.email ?? '';
  el('moderation-logout').hidden=!state.user;el('google-login').hidden=allowed;
  el('login-status').textContent=allowed?'管理者権限を確認しました。':state.phase==='checking'?'管理者権限を確認しています…':state.phase==='denied'?'このアカウントには管理者権限がありません。':'管理者としてGoogleでログインしてください。';
  if(allowed)reset();
});
if(import.meta.hot)import.meta.hot.dispose(()=>{stop();rowsController.abort();controller.abort();});
