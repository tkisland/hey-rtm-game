import type {Chart} from '../src/chart';
import {laneAt} from '../src/chart';
import {GameEngine,playLane} from '../src/engine';
import {playableNotes} from '../src/note-display';

/** An ideal timestamp-by-timestamp play, using only the public engine operations. */
export function autoplayChart(chart:Chart):GameEngine {
  const notes=playableNotes(chart.notes),game=new GameEngine(chart),pressed=new Set<number>();
  const times=[...new Set(notes.flatMap(n=>[n.time,...(n.type==='hold'?[n.endTime]:[]),...(n.path??[]).map(p=>p.time)]))].sort((a,b)=>a-b);
  for(const time of times) {
    for(const note of game.notes.filter(n=>n.state==='holding')) {
      const point=note.path?.[note.pathIndex??0];
      if(point?.time===time){pressed.delete(playLane(note));pressed.add(point.lane);}
    }
    game.advance(time,pressed);
    for(const note of notes)if(note.type==='hold'&&note.endTime===time){game.release(laneAt(note,time),time);pressed.delete(laneAt(note,time));}
    const starts=notes.filter(n=>n.time===time).sort((a,b)=>Number(a.gimmick==='dd')-Number(b.gimmick==='dd'));
    for(const note of starts) {
      if(note.gimmick==='box')for(const lane of [2,3,1,4,0,5])game.input(lane,time);
      else {
        const lane=note.gimmick==='dd'?[0,1,2,3,4,5].find(lane=>!pressed.has(lane))!:note.lane;
        game.input(lane,time);if(note.type==='hold')pressed.add(lane);
      }
    }
    game.advance(time,pressed);
  }
  return game;
}
