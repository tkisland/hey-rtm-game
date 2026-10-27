import {songUrl} from './songs';
import type {Song} from './songs';
import {difficultyLabel} from './difficulties';
import type {Difficulty} from './difficulties';

const publicSite='https://hey.jpn.org/rhythm/';
const numbers=new Intl.NumberFormat('ja-JP');

/** An ordinary user-activated link; no X SDK, credentials or requests during play. */
export function resultShareUrl(song:Song,difficulty:Difficulty,result:{score:number;maxCombo:number;skipped:number}):string {
  const text=[
    '最高なLIVE！',
    `${song.title} / ${difficultyLabel(difficulty)}`,
    `SCORE：${numbers.format(result.score)}`,
    `MAX COMBO：${numbers.format(result.maxCombo)}`,
  ];
  if(result.skipped>0)text.push(`シークでスキップ：${numbers.format(result.skipped)}ノーツ`);
  const intent=new URL('https://twitter.com/intent/tweet');
  intent.searchParams.set('text',text.join('\n'));
  // Build a public play link independently from the current preview/debug URL.
  intent.searchParams.set('url',new URL(songUrl(song,'game',false,difficulty),publicSite).href);
  intent.searchParams.set('hashtags','HeyMommy,HEY_RHYTHM');
  return intent.href;
}
