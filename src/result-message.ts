/** Use base score / the whole chart maximum; bonuses and seeks never inflate it. */
export function resultMessage(baseScore:number):string {
  if(baseScore>=1000000)return '伝説のLIVE！';
  if(baseScore>=950000)return '最高なLIVE！';
  if(baseScore>=850000)return '大盛り上がりのLIVE！';
  if(baseScore>=700000)return 'いい感じのLIVE！';
  if(baseScore>=500000)return 'レスが届いたLIVE！';
  return 'また一緒にLIVEしよう！';
}
