import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {convertMidi,readMidi} from '../src/midi';
import {GameEngine,playLane} from '../src/engine';
import {laneAt} from '../src/chart';
import {bundledChart} from '../src/bundled-charts';
import {BISCUIT_CASE,DEFAULT_SONG} from '../src/songs';
import {playableNotes,chordGroups} from '../src/note-display';
import bsc from '../src/charts/bsc002.json';

const input=readFileSync(new URL('../charts/source/game-BSC002.mid',import.meta.url));
const config=JSON.parse(readFileSync(new URL('../charts/source/game-BSC002.config.json',import.meta.url),'utf8'));
it('ships the exact BSC002 conversion with authored tempo events, 2.95s MIDI origin and initial rest',()=>{
  const chart=convertMidi(input,config),midi=readMidi(input),notes=playableNotes(chart.notes);
  expect(chart).toEqual(bsc);expect(bundledChart(BISCUIT_CASE)).toEqual(chart);
  expect(chart.beatOrigin).toBe(2.95);expect(chart.startTime).toBe(3.85);
  expect(midi.notes[0].tick).toBe(1440);expect(midi.ppq).toBe(480);expect(midi.notes).toHaveLength(783);
  expect(chart.tempoChanges).toEqual(midi.tempos.slice(1).map(t=>({time:Number((t.seconds+2.95).toFixed(9)),bpm:Number((60e6/t.tempo).toFixed(9))})));
  expect(BISCUIT_CASE.tempoChanges).toEqual(chart.tempoChanges);expect(BISCUIT_CASE.tempoEstimated).not.toBe(true);
  expect(chart.notes).toHaveLength(778);expect(notes).toHaveLength(753);expect(chordGroups(notes)).toHaveLength(60);
  expect(notes.filter(n=>n.type==='tap'&&!n.gimmick)).toHaveLength(734);
  expect(notes.filter(n=>n.type==='hold'&&!n.gimmick)).toHaveLength(4);
  for(const [gimmick,count] of [['box',5],['dd',7],['slide',3]])expect(notes.filter(n=>n.gimmick===gimmick)).toHaveLength(count as number);
  expect(Math.max(...notes.map(n=>n.type==='hold'?n.endTime:n.time))).toBe(263.41546715);
  expect(bundledChart(DEFAULT_SONG)!.videoId).toBe('pJDfWpZ7CI4');
  const copy=bundledChart(BISCUIT_CASE)!;copy.notes.length=0;
  expect(bundledChart(BISCUIT_CASE)!.notes).toHaveLength(778);
});
it('keeps the authored slide paths and inclusive 1.5-beat holds',()=>{
  const midi=readMidi(input),chart=convertMidi(input,config);
  expect([...new Set(midi.notes.filter(n=>n.pitch<50).map(n=>n.pitch))].sort((a,b)=>a-b)).toEqual([38,40,41,43,45,47]);
  expect(chart.notes.find(n=>n.time===212.389904754)).toMatchObject({gimmick:'slide',lane:1,path:[{time:212.981036754,lane:0}]});
  expect(chart.notes.filter(n=>n.gimmick==='slide'&&n.time===259.81546715).map(n=>[n.lane,n.path?.map(p=>p.lane)])).toEqual([[0,[1,2]],[5,[4,3]]]);
  for(const raw of midi.notes.filter(n=>n.pitch<50)) {
    const time=Number((midi.secondsAt(raw.tick)+2.95).toFixed(9));
    const note=chart.notes.find(n=>n.time===time&&n.lane===config.lanes[raw.pitch]&&!n.gimmick)!;
    expect(note).toBeDefined();expect(note.type).toBe(raw.endTick-raw.tick>=1.5*midi.ppq?'hold':'tap');
  }
});
it('plays the entire shipped chart with 753 perfect results including authored slides and single-score boxes',()=>{
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
  expect(engine.finished).toBe(true);expect(engine.counts).toEqual({PERFECT:753,GREAT:0,GOOD:0,MISS:0});
  expect(engine.baseScore).toBe(1000000); expect(engine.score).toBe(1105428);expect(engine.combo).toBe(753);
});

it('advances every authored timestamp by 80ms without changing notes or MIDI timing',()=>{
  const previous=convertMidi(input,{...config,offsetSeconds:3.03}),current=convertMidi(input,config);
  expect(current.beatOrigin).toBe(2.95);expect(current.notes).toHaveLength(previous.notes.length);
  for(const [i,note] of current.notes.entries()) {
    const old=previous.notes[i];expect(note.time-old.time).toBeCloseTo(-.08,8);
    if(note.type==='hold'&&old.type==='hold')expect(note.endTime-old.endTime).toBeCloseTo(-.08,8);
    for(const [j,point] of (note.path??[]).entries())expect(point.time-old.path![j].time).toBeCloseTo(-.08,8);
    const identity=({time,endTime,path,...rest}:any)=>rest;
    expect(identity(note)).toEqual(identity(old));
  }
  for(const [i,tempo] of current.tempoChanges!.entries()) {
    expect(tempo.time-previous.tempoChanges![i].time).toBeCloseTo(-.08,8);
    expect(tempo.bpm).toBe(previous.tempoChanges![i].bpm);
  }
});
