import {expect,it} from 'vitest';
import {DemoPlayer} from '../src/demo-player';
import {GameEngine} from '../src/engine';
import {SONGS} from '../src/songs';
import {bundledChart} from '../src/bundled-charts';
import {autoplayChart} from './chart-autoplay';

for(const song of SONGS)it(`demonstrates every operation of ${song.id}, including delayed frames`,()=>{
  const chart=bundledChart(song)!,expected=autoplayChart(chart),game=new GameEngine(chart),demo=new DemoPlayer(game);
  const presses:number[]=[];
  const end=Math.max(...game.notes.map(n=>n.type==='hold'?n.endTime:n.time));
  for(let time=0;time<end+.5;time+=.37)demo.advance(time,lane=>presses.push(lane));
  expect(game.counts).toEqual(expected.counts);expect(game.score).toBe(expected.score);
  expect(game.counts.MISS).toBe(0);expect(game.baseScore).toBe(1000000);expect(game.finished).toBe(true);
  expect(presses.length).toBeGreaterThan(0);
  const count=presses.length;demo.advance(end+1,lane=>presses.push(lane));expect(presses).toHaveLength(count);
  game.reset();demo.reset();demo.advance(end+.1,()=>{});
  expect(game.counts).toEqual(expected.counts);expect(game.score).toBe(expected.score);
});
it('keeps holds across pauses and rebuilds the schedule after seeking',()=>{
  const chart={videoId:'abcdefghijk',title:'Demo',bpm:120,startTime:1,notes:[
    {id:1,type:'hold' as const,lane:0,time:1,endTime:3,gimmick:'slide' as const,path:[{time:2,lane:5}]},
    {id:2,type:'tap' as const,lane:2,time:4},
  ]};
  const game=new GameEngine(chart),demo=new DemoPlayer(game),presses:number[]=[];
  demo.advance(1,lane=>presses.push(lane));expect(demo.pressed.has(0)).toBe(true);
  for(let i=0;i<10;i++)demo.advance(1,()=>{throw Error('paused notes must not repeat');});
  demo.advance(2,lane=>presses.push(lane));expect(demo.pressed.has(5)).toBe(true);expect(demo.pressed.has(0)).toBe(false);
  demo.advance(3,()=>{});expect(demo.pressed.size).toBe(0);expect(game.counts.PERFECT).toBe(1);
  game.seek(3.5,false);demo.reset();demo.advance(4,()=>{});expect(game.counts.PERFECT).toBe(2);
  game.seek(3.5,true);demo.reset();demo.advance(4,()=>{});expect(game.skipped).toBe(1);expect(game.counts).toEqual({PERFECT:1,GREAT:0,GOOD:0,MISS:0});
});
