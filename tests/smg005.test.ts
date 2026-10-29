import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {convertMidi,readMidi} from '../src/midi';
import {GameEngine,playLane} from '../src/engine';
import {laneAt} from '../src/chart';
import {bundledChart} from '../src/bundled-charts';
import {DEFAULT_SONG} from '../src/songs';
import {playableNotes,chordGroups} from '../src/note-display';
import smg from '../src/charts/smg005.json';

const input=readFileSync(new URL('../charts/source/game-SMG005.mid',import.meta.url));
const config=JSON.parse(readFileSync(new URL('../charts/source/game-SMG005.config.json',import.meta.url),'utf8'));
it('ships the SMG005 MIDI with its tempo map, confirmed origin and all five note types',()=>{
  const chart=convertMidi(input,config);
  expect(chart).toEqual(smg); expect(bundledChart(DEFAULT_SONG)).toEqual(chart);
  expect(chart.startTime).toBe(7.65); expect(chart.beatOrigin).toBe(7.65);
  expect(chart.tempoChanges).toEqual([{time:18.626632844,bpm:192}]);
  expect(chart.notes).toHaveLength(540);
  const notes=playableNotes(chart.notes); expect(notes).toHaveLength(508);
  expect(chordGroups(notes)).toHaveLength(28);
  expect(notes.filter(n=>n.type==='tap'&&!n.gimmick)).toHaveLength(472);
  expect(notes.filter(n=>n.type==='hold'&&!n.gimmick)).toHaveLength(17);
  for(const [gimmick,count] of [['box',6],['dd',9],['slide',4]]) expect(notes.filter(n=>n.gimmick===gimmick)).toHaveLength(count as number);
  expect(notes.find(n=>n.time===127.261398469)).toMatchObject({gimmick:'slide',lane:4,path:[{time:127.886398469,lane:3}]});
  expect(Math.max(...notes.map(n=>n.type==='hold'?n.endTime:n.time))).toBe(214.64095576);
});
it('maps the uploaded pitch 44 to purple without altering the source MIDI',()=>{
  const midi=readMidi(input), note=midi.notes.find(n=>n.pitch===44)!;
  expect(midi.notes).toHaveLength(549); expect(note.tick).toBe(97920);
  expect(config.lanes['44']).toBe(config.lanes['45']);
  const chart=convertMidi(input,config);
  expect(chart.notes.find(n=>n.time===72.886398469)).toMatchObject({type:'tap',lane:4});
  const ordinary=midi.notes.filter(n=>config.lanes[n.pitch]!==undefined);
  for(const raw of ordinary) {
    const time=Number((midi.secondsAt(raw.tick)+7.65).toFixed(9));
    const note=chart.notes.find(n=>n.time===time&&n.lane===config.lanes[raw.pitch]&&!n.gimmick)!;
    expect(note).toBeDefined();
    expect(note.type).toBe(raw.endTick-raw.tick>=1.5*midi.ppq?'hold':'tap');
  }
});
it('plays the entire shipped chart with 508 perfect results including authored slides and single-score boxes',()=>{
  const chart=convertMidi(input,config), notes=playableNotes(chart.notes), engine=new GameEngine(chart), pressed=new Set<number>();
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
      if(note.gimmick==='box') for(const lane of [2,3,1,4,0,5]) expect(engine.input(lane,time)?.judgement).toBe('PERFECT');
      else {
        const lane=note.gimmick==='dd'?[0,1,2,3,4,5].find(lane=>!pressed.has(lane))!:note.lane;
        expect(engine.input(lane,time)?.judgement).toBe('PERFECT');
        if(note.type==='hold') pressed.add(lane);
      }
    }
    engine.advance(time,pressed);
  }
  expect(engine.finished).toBe(true);expect(engine.counts).toEqual({PERFECT:508,GREAT:0,GOOD:0,MISS:0});
  expect(engine.baseScore).toBe(1000000); expect(engine.score).toBe(1166755);expect(engine.combo).toBe(508);
});
