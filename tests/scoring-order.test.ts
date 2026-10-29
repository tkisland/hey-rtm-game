import {expect,it} from 'vitest';
import {GameEngine} from '../src/engine';
import type {Chart} from '../src/chart';

const chart:Chart={videoId:'test',title:'Order',bpm:120,startTime:0,notes:[
  ...Array.from({length:9},(_,i)=>({id:i+1,time:i+1,lane:0,type:'tap' as const})),
  {id:10,time:10,lane:1,type:'hold',endTime:12.1},
  {id:11,time:12,lane:2,type:'tap'},
  {id:12,time:13,lane:3,type:'tap'},
]};
function play(early:boolean,fail=false):GameEngine {
  const game=new GameEngine(chart);
  for(let time=1;time<=9;time++)game.input(0,time);
  game.input(1,10);
  if(early)game.release(1,fail?10.1:12);
  game.input(2,12);
  if(!early)game.release(1,fail?12.5:12.2);
  game.input(3,13);return game;
}
it('uses authored completion order when valid hold releases cross a nearby tap',()=>{
  const early=play(true),late=play(false);
  // Both releases PERFECT, but input completion order is opposite.
  expect(early.counts).toEqual(late.counts);expect(early.score).toBe(late.score);
  expect(early.maxCombo).toBe(late.maxCombo);expect(early.comboBonus).toBe(late.comboBonus);
  expect(early.rankingJudgements().map(n=>n.id)).toEqual([1,2,3,4,5,6,7,8,9,11,10,12]);
});
it('places failed holds at the same authored endpoint even when failure occurs at the start',()=>{
  const early=play(true,true),late=play(false,true);
  expect(early.counts).toEqual(late.counts);expect(early.score).toBe(late.score);
  expect(early.maxCombo).toBe(10);expect(late.maxCombo).toBe(10);
});
it('uses note ID as the simultaneous tie-breaker independently of finger order',()=>{
  const data:Chart={...chart,notes:[...chart.notes.slice(0,9),{id:10,time:10,lane:1,type:'tap'},{id:11,time:10,lane:2,type:'tap'}]};
  const playChord=(reverse:boolean)=>{
    const game=new GameEngine(data);for(let time=1;time<=9;time++)game.input(0,time);
    for(const lane of reverse?[2,1]:[1,2])game.input(lane,lane===1?10:reverse?9.92:10.08);
    return game;
  };
  const a=playChord(false),b=playChord(true);
  expect(a.score).toBe(b.score);expect(a.comboBonus).toBe(b.comboBonus);expect(a.rankingJudgements()).toEqual(b.rankingJudgements());
});
