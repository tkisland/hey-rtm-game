import {resultMessage} from './result-message';
import {SCORE_RULES_VERSION} from './engine';
import type {Song} from './songs';
import {difficultyLabel} from './difficulties';
import type {Difficulty} from './difficulties';

const publicSite='https://hey.jpn.org/rhythm/';
const numbers=new Intl.NumberFormat('ja-JP');

/** An ordinary user-activated link; no X SDK, credentials or requests during play. */
export function resultShareUrl(song:Song,difficulty:Difficulty,result:{score:number;baseScore:number;maxCombo:number;skipped:number}):string {
  const text=[
    '#HeyRhythm',
    resultMessage(result.baseScore)+(result.skipped>0?`（シークでスキップ：${numbers.format(result.skipped)}ノーツ）`:''),
    `${song.title} / ${difficultyLabel(difficulty)}`,
    `SCORE：${numbers.format(result.score)}`,
    `MAX COMBO：${numbers.format(result.maxCombo)}`,
  ];
  const intent=new URL('https://twitter.com/intent/tweet');
  // Build a public play link independently from the current preview/debug URL.
  const page=new URL('share.php',publicSite);
  page.search=new URLSearchParams({song:song.id,difficulty,v:String(SCORE_RULES_VERSION),art:'3',score:String(result.score),base:String(result.baseScore),combo:String(result.maxCombo),skipped:String(result.skipped)}).toString();
  text.push(page.href);
  intent.searchParams.set('text',text.join('\n'));
  return intent.href;
}
