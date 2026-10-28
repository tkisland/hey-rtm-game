import {expect,it} from 'vitest';
import {GameEngine} from '../src/engine';
import type {Chart,ChartNote} from '../src/chart';

const chart=(notes:ChartNote[],extra:Partial<Chart>={}):Chart=>({videoId:'test',title:'scoring',bpm:120,startTime:0,notes,...extra});
const taps=(count:number):ChartNote[]=>Array.from({length:count},(_,i)=>({id:i,time:i+1,lane:0,type:'tap'}));

it('normalizes base score once over the whole chart, with no loss from individual rounding',()=>{
  const game=new GameEngine(chart(taps(3)));
  game.input(0,1);expect(game.baseScore).toBe(333333);
  game.input(0,2);expect(game.baseScore).toBe(666666);
  game.input(0,3);expect(game.baseScore).toBe(1000000);expect(game.score).toBe(1000000);
  game.reset(chart([]));expect(game.score).toBe(0);expect(game.accuracy).toBe(0);
});
it('uses judgement weights for base accuracy without counting bonus as accuracy',()=>{
  const game=new GameEngine(chart(taps(4)));
  game.input(0,1);game.input(0,2.08);game.input(0,3.15);game.advance(4.17);
  expect(game.baseScore).toBe(500000);expect(game.accuracy).toBe(50);
  expect(game.counts).toEqual({PERFECT:1,GREAT:1,GOOD:1,MISS:1});
});
it('increments combo tiers at 10, caps at 100, and preserves earned bonus after MISS',()=>{
  const game=new GameEngine(chart(taps(111)));
  for(let time=1;time<=9;time++)game.input(0,time);
  expect(game.comboBonus).toBe(0);
  game.input(0,10);expect(game.comboBonus).toBe(90); // floor(1,000,000 / 111 * 1%)
  for(let time=11;time<=110;time++)game.input(0,time);
  // 10 notes in tiers 1..9 and 11 notes in tier 10 = 560 tier units.
  expect(game.comboBonus).toBe(Math.floor(5600000/111));
  const earned=game.comboBonus;game.advance(111.17);
  expect(game.combo).toBe(0);expect(game.comboBonus).toBe(earned);
  expect(game.score).toBe(game.baseScore+game.comboBonus);expect(game.accuracy).toBeLessThanOrEqual(100);
});
it('restarts the combo bonus tier after a MISS and scales it by the final grade',()=>{
  const game=new GameEngine(chart(taps(21)));
  for(let time=1;time<=10;time++)game.input(0,time);
  game.advance(11.17);
  for(let time=12;time<=20;time++)game.input(0,time);
  const before=game.comboBonus;game.input(0,21.15);
  expect(before).toBe(Math.floor(10000/21));
  expect(game.comboBonus).toBe(Math.floor(13000/21));
});
it('counts whole hold beats through tempo changes and commits bonus only on successful release',()=>{
  const data=chart([{id:1,type:'hold',lane:0,time:1,endTime:3}],{tempoChanges:[{time:2,bpm:180}]});
  const game=new GameEngine(data);game.input(0,1);game.advance(2,new Set([0]));
  expect(game.score).toBe(0);expect(game.specialBonus).toBe(0);
  game.release(0,3.15); // 2 beats + 3 beats, GREAT => 500 * .7
  expect(game.baseScore).toBe(700000);expect(game.specialBonus).toBe(350);expect(game.score).toBe(700350);
  expect(game.accuracy).toBe(70);
  game.reset();game.input(0,1);game.release(0,2.5);
  expect(game.score).toBe(0);expect(game.specialBonus).toBe(0);
});
it('uses the worst slide checkpoint grade for all special bonus, and a missed tail forfeits it',()=>{
  const game=new GameEngine(chart([{id:1,type:'hold',gimmick:'slide',lane:0,time:1,endTime:3,path:[{time:2,lane:5}]}]));
  game.input(0,1);game.advance(2.12,new Set([5]));expect(game.specialBonus).toBe(0);game.release(5,3);
  expect(game.specialBonus).toBe(490);expect(game.score).toBe(700490); // (4*100 + 300) * .7
  game.reset();game.input(0,1);game.advance(2,new Set([5]));game.release(5,2.5);
  expect(game.score).toBe(0);
});
it('awards one quality-weighted box completion and one DD bonus, never per lane or repeated press',()=>{
  const game=new GameEngine(chart([
    ...Array.from({length:6},(_,lane):ChartNote=>({id:lane,lane,time:1+lane*.02,type:'tap',gimmick:'box',boxId:1})),
    {id:6,lane:0,time:2,type:'tap',gimmick:'dd'},
  ]));
  for(const lane of [2,3,1,4,0])game.input(lane,1.2);
  expect(game.specialBonus).toBe(0);game.input(5,1.2);
  expect(game.specialBonus).toBe(700); // GREAT
  game.input(4,2.15);expect(game.specialBonus).toBe(790); // GOOD
  expect(game.baseScore).toBe(500000);expect(game.score).toBe(500790);
  for(let lane=0;lane<6;lane++)game.input(lane,2.15);
  expect(game.score).toBe(500790);
});
it('forfeits base, combo and special bonus for a failed chord, while preserving successful judgement counts',()=>{
  const notes=taps(10);notes[9]={id:9,lane:0,time:10,type:'hold',endTime:12};notes.push({id:10,lane:1,time:10,type:'tap'});
  const game=new GameEngine(chart(notes));
  for(let time=1;time<=9;time++)game.input(0,time);
  game.input(0,10);game.input(1,10);expect(game.score).toBe(Math.floor(9000000/11));
  game.release(0,11);expect(game.comboBonus).toBe(0);expect(game.specialBonus).toBe(0);
  expect(game.counts.PERFECT).toBe(10);expect(game.counts.MISS).toBe(1);
});
it('does not renormalize a seek to a million and resets all score components on replay',()=>{
  const game=new GameEngine(chart(taps(20)));
  for(let time=1;time<=10;time++)game.input(0,time);
  expect(game.comboBonus).toBe(500);game.seek(19.5,false);game.input(0,20);
  expect(game.baseScore).toBe(550000);expect(game.comboBonus).toBe(500);expect(game.skipped).toBe(9);
  game.seek(0,true);expect(game.score).toBe(0);expect(game.baseScore).toBe(0);expect(game.comboBonus).toBe(0);expect(game.specialBonus).toBe(0);
});
