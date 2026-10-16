import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {convertMidi,readMidi} from '../src/midi';
import {GameEngine,playLane} from '../src/engine';
import {laneAt} from '../src/chart';
import {playableNotes} from '../src/note-display';
import {bundledChart} from '../src/bundled-charts';
import {DEFAULT_SONG} from '../src/songs';
import smg from '../src/charts/smg003.json';

const input=readFileSync(new URL('../charts/source/game-SMG003.mid',import.meta.url));
const config=JSON.parse(readFileSync(new URL('../charts/source/game-SMG003.config.json',import.meta.url),'utf8'));
it('ships the SMG003 MIDI with its tempo map, confirmed origin and all five note types',()=>{
  const chart=convertMidi(input,config);
  expect(chart).toEqual(smg); expect(bundledChart(DEFAULT_SONG)).toEqual(chart);
  expect(chart.startTime).toBe(7.65); expect(chart.beatOrigin).toBe(7.65);
  expect(chart.tempoChanges).toEqual([{time:18.626632844,bpm:192}]);
  expect(chart.notes).toHaveLength(534);
  const notes=playableNotes(chart.notes); expect(notes).toHaveLength(509);
  expect(notes.filter(n=>n.type==='tap'&&!n.gimmick)).toHaveLength(471);
  expect(notes.filter(n=>n.type==='hold'&&!n.gimmick)).toHaveLength(19);
  for(const [gimmick,count] of [['box',5],['dd',10],['slide',4]]) expect(notes.filter(n=>n.gimmick===gimmick)).toHaveLength(count as number);
  expect(notes.find(n=>n.time===127.261398469)).toMatchObject({gimmick:'slide',lane:4,path:[{time:127.886398469,lane:0}]});
  expect(Math.max(...notes.map(n=>n.type==='hold'?n.endTime:n.time))).toBe(214.64095576);
});
it('changes only the authorized pitch and duplicate note while preserving MIDI timing and tracks',()=>{
  const original=readMidi(readFileSync(new URL('../charts/source/game-SMG003.original.mid',import.meta.url)));
  const corrected=readMidi(input);
  expect(original.notes.filter(n=>n.pitch===58)).toHaveLength(1);
  expect(original.notes.filter(n=>n.tick===302400&&n.pitch===45)).toHaveLength(1);
  const expected=original.notes.filter(n=>!(n.tick===302400&&n.pitch===45)).map(n=>({...n,pitch:n.pitch===58?59:n.pitch}));
  expect(corrected.notes).toEqual(expected);
  expect(corrected.ppq).toBe(original.ppq); expect(corrected.tempos).toEqual(original.tempos);
});
it('plays the entire shipped chart with 509 perfect results including distant slides and single-score boxes',()=>{
  const chart=bundledChart(DEFAULT_SONG)!, notes=playableNotes(chart.notes), engine=new GameEngine(chart), pressed=new Set<number>();
  const times=[...new Set(notes.flatMap(n=>[n.time,...(n.type==='hold'?[n.endTime]:[]),...(n.path??[]).map(p=>p.time)]))].sort((a,b)=>a-b);
  for(const time of times) {
    for(const note of engine.notes.filter(n=>n.state==='holding')) {
      const point=note.path?.[note.pathIndex??0];
      if(point?.time===time) {pressed.delete(playLane(note));pressed.add(point.lane);}
    }
    engine.advance(time,pressed);
    for(const note of notes) if(note.type==='hold'&&note.endTime===time) {
      engine.release(laneAt(note,time),time);pressed.delete(laneAt(note,time));
    }
    const starts=notes.filter(n=>n.time===time).sort((a,b)=>Number(a.gimmick==='dd')-Number(b.gimmick==='dd'));
    for(const note of starts) {
      if(note.gimmick==='box') for(let lane=0;lane<6;lane++) expect(engine.input(lane,time)?.judgement).toBe('PERFECT');
      else {
        const lane=note.gimmick==='dd'?[0,1,2,3,4,5].find(lane=>!pressed.has(lane))!:note.lane;
        expect(engine.input(lane,time)?.judgement).toBe('PERFECT');
        if(note.type==='hold') pressed.add(lane);
      }
    }
    engine.advance(time,pressed);
  }
  expect(engine.finished).toBe(true);expect(engine.counts).toEqual({PERFECT:509,GREAT:0,GOOD:0,MISS:0});
  expect(engine.score).toBe(509000);expect(engine.combo).toBe(509);
});
