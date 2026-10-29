import './ranking.css';
import {chartHash,rankingBoard,rankingEnabled,startRanking,loadRanking,submitRanking,normalizeRankingName,renderRanking,RankingError} from './ranking-api';
import type {RankingBoard,RankingResult} from './ranking-api';
import type {Difficulty} from './difficulties';

export function mountResultRanking(songId:string,difficulty:Difficulty,json:string) {
  const section=document.getElementById('result-ranking')!;
  const form=document.getElementById('ranking-form') as HTMLFormElement,input=document.getElementById('ranking-name') as HTMLInputElement;
  const button=document.getElementById('ranking-submit') as HTMLButtonElement,status=document.getElementById('ranking-status')!;
  const list=document.getElementById('ranking-entries') as HTMLOListElement;
  const controller=new AbortController();
  let generation=0,alive=true,token:string|null=null,result:RankingResult|null=null,invalid='',submitted=false,busy=false;
  let preparation:Promise<void>=Promise.resolve(),started=false;
  const board:Promise<RankingBoard>=chartHash(json).then(hash=>rankingBoard(songId,difficulty,hash));
  const errorText=(error:unknown)=>error instanceof RankingError?error.message:'ランキングを利用できません。';
  let preparationError='';
  function reset():void {
    generation++;token=null;result=null;invalid='';submitted=false;busy=false;preparationError='';section.hidden=true;
    input.value='';input.disabled=false;button.disabled=false;list.replaceChildren();status.textContent='';
    started=false;preparation=Promise.resolve();
  }
  function start():void {
    if(started || !alive || invalid)return;
    started=true;const current=generation;
    preparation=(async()=>{
      try {
        const [enabled,currentBoard]=await Promise.all([rankingEnabled(),board]);
        if(!enabled)throw new RankingError('not_configured','ランキングは準備中です。');
        if(!alive || current!==generation)return;
        const next=await startRanking(currentBoard);if(alive && current===generation)token=next;
      }catch(error){if(alive && current===generation)preparationError=errorText(error);}
    })();
  }
  async function refresh(current:number,highlight?:string):Promise<void> {
    const entries=await loadRanking(await board);
    if(!alive || current!==generation)return;
    renderRanking(list,entries,highlight);
    if(!submitted && !entries.length && !invalid && !preparationError)status.textContent='まだ記録がありません。最初の記録を登録しよう！';
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();if(busy || submitted || !result || !token || invalid)return;
    const name=normalizeRankingName(input.value);
    if(!name){status.textContent='名前は半角英数字3〜6文字で入力してください。';input.focus();return;}
    const current=generation,playResult=result,playToken=token;input.value=name;busy=true;button.disabled=true;input.disabled=true;
    status.textContent='登録しています…';
    void submitRanking(playToken,name,playResult).then(async response=>{
      if(!alive || current!==generation)return;
      submitted=true;status.textContent=`${response.entry.name} で登録しました！ ${response.rank}位`;
      try{await refresh(current,response.entry.id);}catch{/* The registration is already committed; retrying must not duplicate it. */}
    }).catch(error=>{
      if(!alive || current!==generation)return;
      status.textContent=errorText(error);
      if(error instanceof RankingError && ['expired','already_submitted'].includes(error.code))submitted=true;
    }).finally(()=>{
      if(!alive || current!==generation)return;
      busy=false;button.disabled=submitted;input.disabled=submitted;
    });
  },{signal:controller.signal});
  reset();
  return {
    start,
    restart:reset,
    invalidate(reason:string){if(!result)invalid ||= reason;},
    clear(){section.hidden=true;result=null;},
    async show(value:RankingResult,eligible:boolean):Promise<void>{
      const current=generation;result=value;section.hidden=false;form.hidden=true;status.textContent='ランキングを確認しています…';
      if(!started)invalid ||= '再生開始を確認できませんでした。もういちどプレイしてください。';
      if(!eligible)invalid ||= 'シークや再生速度の変更があるプレイは登録できません。';
      await preparation;
      if(!alive || current!==generation)return;
      form.hidden=!token || !!invalid;
      status.textContent=preparationError || invalid || '英数字3〜6文字の名前で登録できます。';
      if(token){try{await refresh(current);}catch(error){if(alive && current===generation)status.textContent=errorText(error);}}
    },
    destroy(){alive=false;generation++;controller.abort();},
  };
}
