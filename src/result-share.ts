import {resultMessage} from './result-message';
import type {Song} from './songs';
import {difficultyLabel} from './difficulties';
import type {Difficulty} from './difficulties';

const publicSite='https://hey.jpn.org/rhythm/';
const numbers=new Intl.NumberFormat('ja-JP');

/** An ordinary user-activated link; no X SDK, credentials or requests during play. */
export function resultShareUrl(song:Song,difficulty:Difficulty,result:{score:number;baseScore:number;maxCombo:number;skipped:number},shareId?:string):string {
  const text=[
    '#HeyRhythm',
    resultMessage(result.baseScore)+(result.skipped>0?`（シークでスキップ：${numbers.format(result.skipped)}ノーツ）`:''),
    `${song.title} / ${difficultyLabel(difficulty)}`,
    `SCORE：${numbers.format(result.score)}`,
    `MAX COMBO：${numbers.format(result.maxCombo)}`,
  ];
  const intent=new URL('https://twitter.com/intent/tweet');
  // Build a public play link independently from the current preview/debug URL.
  if(shareId!==undefined&&!/^[a-f0-9]{32}$/.test(shareId))throw new Error('Invalid share result ID');
  const page=new URL(shareId?'share.php':'game.html',publicSite);
  page.search=new URLSearchParams(shareId?{id:shareId}:{song:song.id,difficulty}).toString();
  text.push(page.href);
  intent.searchParams.set('text',text.join('\n'));
  return intent.href;
}
