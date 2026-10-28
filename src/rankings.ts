import './style.css';
import './menu.css';
import './ranking.css';
import {SONGS,findSong,songUrl} from './songs';
import {DIFFICULTIES,findDifficulty,DEFAULT_DIFFICULTY} from './difficulties';
import {bundledChart} from './bundled-charts';
import {publishedChart} from './cloud-published';
import {rankingEnabled,rankingBoard,chartHash,loadRanking,renderRanking} from './ranking-api';

const songSelect=document.getElementById('ranking-song') as HTMLSelectElement;
const difficultySelect=document.getElementById('ranking-difficulty') as HTMLSelectElement;
const status=document.getElementById('ranking-page-status')!,list=document.getElementById('ranking-page-entries') as HTMLOListElement;
const play=document.getElementById('ranking-play') as HTMLAnchorElement;
for(const song of SONGS){const option=document.createElement('option');option.value=song.id;option.textContent=song.title;songSelect.append(option);}
for(const difficulty of DIFFICULTIES){const option=document.createElement('option');option.value=difficulty.id;option.textContent=difficulty.label;difficultySelect.append(option);}
const params=new URLSearchParams(location.search);
songSelect.value=(findSong(params.get('song')) ?? SONGS[0]).id;
difficultySelect.value=findDifficulty(params.get('difficulty')) ?? DEFAULT_DIFFICULTY;
let generation=0;
async function show():Promise<void>{
  const current=++generation,song=findSong(songSelect.value)!,difficulty=findDifficulty(difficultySelect.value)!;
  status.textContent='ランキングを読み込んでいます…';list.replaceChildren();play.hidden=true;
  const url=new URL(location.href);url.searchParams.set('song',song.id);url.searchParams.set('difficulty',difficulty);history.replaceState(null,'',url);
  try {
    const online=await publishedChart(song,difficulty),chart=online?.chart ?? bundledChart(song,difficulty);
    if(current!==generation)return;
    if(!chart){status.textContent='この難易度の譜面は準備中です。';return;}
    play.href=songUrl(song,'game',false,difficulty);play.hidden=false;
    if(!await rankingEnabled()){if(current===generation)status.textContent='ランキングは準備中です。';return;}
    const entries=await loadRanking(rankingBoard(song.id,difficulty,await chartHash(online?.json ?? JSON.stringify(chart))));
    if(current!==generation)return;
    renderRanking(list,entries);status.textContent=entries.length?'点数 → 最大コンボ → 登録順で表示しています。':'まだ記録がありません。最初の記録を登録しよう！';
  }catch(error){if(current===generation)status.textContent=error instanceof Error?error.message:'ランキングを読み込めませんでした。';}
}
songSelect.addEventListener('change',()=>void show());difficultySelect.addEventListener('change',()=>void show());
document.getElementById('ranking-refresh')!.addEventListener('click',()=>void show());
void show();
