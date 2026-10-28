import type {Difficulty} from './difficulties';
import type {Judgement} from './engine';
import {SCORE_RULES_VERSION} from './engine';
export interface RankingBoard {songId:string;difficulty:Difficulty;chartHash:string;rulesVersion:number}
export function rankingBoard(songId:string,difficulty:Difficulty,hash:string):RankingBoard {return {songId,difficulty,chartHash:hash,rulesVersion:SCORE_RULES_VERSION};}
export interface RankingEntry {id:string;name:string;score:number;maxCombo:number;createdAt:number}
export interface RankingResult {score:number;maxCombo:number;results:{id:number;judgement:Judgement}[]}
export class RankingError extends Error {constructor(public code:string,message:string){super(message);}}
const endpoint = () => new URL('./api/ranking.php',location.href);
async function request(action:string,data:Record<string,unknown>={},post=false):Promise<any> {
  const url=endpoint();url.searchParams.set('action',action);
  if(!post)for(const [key,value] of Object.entries(data))url.searchParams.set(key,String(value));
  let response:Response,body:any;
  try {
    response=await fetch(url,{method:post?'POST':'GET',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(12000),
      ...(post?{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})});
    body=await response.json();
  }catch{throw new RankingError('connection','ランキングに接続できません。通信を確認して、もう一度お試しください。');}
  if(!response.ok || body.ok!==true)throw new RankingError(typeof body.code==='string'?body.code:'unavailable',typeof body.message==='string'?body.message:'ランキングを利用できません。');
  return body;
}
export async function chartHash(json:string):Promise<string> {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(json));
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
export async function rankingEnabled():Promise<boolean> {return (await request('status')).enabled===true;}
export async function startRanking(board:RankingBoard):Promise<string> {return (await request('start',{...board},true)).token;}
export async function loadRanking(board:RankingBoard):Promise<RankingEntry[]> {return (await request('leaderboard',{...board})).entries;}
export async function submitRanking(token:string,name:string,result:RankingResult):Promise<{entry:RankingEntry;rank:number}> {
  return request('submit',{token,name,...result},true);
}
export function normalizeRankingName(value:string):string|null {return /^[a-zA-Z0-9]{3,6}$/.test(value)?value.toUpperCase():null;}
export function renderRanking(list:HTMLOListElement,entries:RankingEntry[],highlight?:string):void {
  list.replaceChildren();
  const format=new Intl.NumberFormat('ja-JP');
  for(const [index,entry] of entries.entries()){
    const row=document.createElement('li');if(entry.id===highlight)row.classList.add('ranking-own');
    const name=document.createElement('strong');name.textContent=`${index+1}. ${entry.name}`;
    const score=document.createElement('span');score.textContent=`${format.format(entry.score)} / COMBO ${format.format(entry.maxCombo)}`;
    row.append(name,score);list.append(row);
  }
}
