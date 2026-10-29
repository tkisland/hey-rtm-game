import {expect,it} from 'vitest';
import smg from '../src/charts/smg005.json';
import {GameEngine} from '../src/engine';
import type {Chart,ChartNote} from '../src/chart';
import {playableNotes} from '../src/note-display';

for(const id of [267,302])for(const [offset,grade] of [[-.15,'GREAT'],[.15,'GREAT'],[-.22,'GOOD'],[.22,'GOOD']] as const) {
  it(`SMG slide ${id} released at ${offset}s keeps one ${grade} instead of a tail-tap MISS`,()=>{
    const slide=smg.notes.find(n=>n.id===id)! as ChartNote&{type:'hold'};
    const lane=slide.path!.at(-1)!.lane;
    const tail=smg.notes.find(n=>n.type==='tap'&&!n.gimmick&&n.time===slide.endTime&&n.lane===lane)!;
    expect(tail).toBeDefined();
    const chart={...smg,notes:[slide,tail]} as Chart,game=new GameEngine(chart);
    game.advance(slide.time,new Set([slide.lane]));game.input(slide.lane,slide.time);
    for(const point of slide.path!)game.advance(point.time,new Set([point.lane]));
    const hits=game.advance(slide.endTime+offset,new Set());
    hits.push(...game.release(lane,slide.endTime+offset));
    hits.push(...game.advance(slide.endTime+.3,new Set()));
    expect(hits.map(hit=>hit.judgement)).toEqual([grade]);
    expect(game.notes).toHaveLength(1);expect(game.counts[grade]).toBe(1);expect(game.counts.MISS).toBe(0);
    expect(game.combo).toBe(1);expect(game.finished).toBe(true);
    expect(chart.notes).toHaveLength(2); // Imported/editor data remains intact.
  });
}
it('only coalesces a plain tap at the slide tail, preserving real following notes and ordinary hold/tap pairs',()=>{
  const slide:ChartNote={id:1,type:'hold',gimmick:'slide',time:1,endTime:3,lane:0,path:[{time:2,lane:3}]};
  const notes:ChartNote[]=[slide,{id:2,type:'tap',time:3,lane:3},{id:3,type:'tap',time:3,lane:4},
    {id:4,type:'tap',time:3.01,lane:3},{id:5,type:'tap',gimmick:'dd',time:3,lane:3},
    {id:6,type:'hold',time:4,endTime:5,lane:0},{id:7,type:'tap',time:5,lane:0}];
  expect(playableNotes(notes).map(n=>n.id)).toEqual([1,3,4,5,6,7]);
});
it('still MISSes an invalid slide release once, without a second synthetic tail failure',()=>{
  const game=new GameEngine({...smg,notes:smg.notes.filter(n=>n.id===267||n.id===268)} as Chart);
  const slide=game.notes[0];game.advance(slide.time,new Set([slide.lane]));game.input(slide.lane,slide.time);
  for(const point of slide.path!)game.advance(point.time,new Set([point.lane]));
  game.release(3,114.136398469-.3);game.advance(115,new Set());
  expect(game.counts.MISS).toBe(1);expect(game.score).toBe(0);expect(game.combo).toBe(0);
});
