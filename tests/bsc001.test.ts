import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {convertMidi,readMidi} from '../src/midi';
import {GameEngine,playLane} from '../src/engine';
import {laneAt} from '../src/chart';
import {bundledChart} from '../src/bundled-charts';
import {BISCUIT_CASE,DEFAULT_SONG} from '../src/songs';
import {playableNotes,chordGroups} from '../src/note-display';
import bsc from '../src/charts/bsc001.json';

const input=readFileSync(new URL('../charts/source/game-BSC001.mid',import.meta.url));
const config=JSON.parse(readFileSync(new URL('../charts/source/game-BSC001.config.json',import.meta.url),'utf8'));
it('ships the exact BSC001 conversion with authored tempo events, 3.03s MIDI origin and initial rest',()=>{
  const chart=convertMidi(input,config),midi=readMidi(input),notes=playableNotes(chart.notes);
  expect(chart).toEqual(bsc);expect(bundledChart(BISCUIT_CASE)).toEqual(chart);
  expect(chart.beatOrigin).toBe(3.03);expect(chart.startTime).toBe(3.93);
  expect(midi.notes[0].tick).toBe(1440);expect(midi.ppq).toBe(480);expect(midi.notes).toHaveLength(800);
  expect(chart.tempoChanges).toEqual(midi.tempos.slice(1).map(t=>({time:Number((t.seconds+3.03).toFixed(9)),bpm:Number((60e6/t.tempo).toFixed(9))})));
  expect(BISCUIT_CASE.tempoChanges).toEqual(chart.tempoChanges);expect(BISCUIT_CASE.tempoEstimated).not.toBe(true);
  expect(chart.notes).toHaveLength(795);expect(notes).toHaveLength(770);expect(chordGroups(notes)).toHaveLength(62);
  expect(notes.filter(n=>n.type==='tap'&&!n.gimmick)).toHaveLength(751);
  expect(notes.filter(n=>n.type==='hold'&&!n.gimmick)).toHaveLength(4);
  for(const [gimmick,count] of [['box',5],['dd',7],['slide',3]])expect(notes.filter(n=>n.gimmick===gimmick)).toHaveLength(count as number);
  expect(Math.max(...notes.map(n=>n.type==='hold'?n.endTime:n.time))).toBe(263.49546715);
  expect(bundledChart(DEFAULT_SONG)!.videoId).toBe('pJDfWpZ7CI4');
  const copy=bundledChart(BISCUIT_CASE)!;copy.notes.length=0;
  expect(bundledChart(BISCUIT_CASE)!.notes).toHaveLength(795);
});
it('keeps original pitches while mapping 36 to pink and 63 to the white slide lane, with inclusive 1.5-beat holds',()=>{
  const midi=readMidi(input),chart=convertMidi(input,config);
  expect(midi.notes.filter(n=>n.pitch===36)).toHaveLength(1);expect(midi.notes.filter(n=>n.pitch===63)).toHaveLength(1);
  expect(chart.notes.find(n=>n.time===79.946882754)).toMatchObject({type:'tap',lane:0});
  expect(chart.notes.find(n=>n.time===212.469904754)).toMatchObject({gimmick:'slide',lane:1,path:[{time:213.061036754,lane:2}]});
  expect(chart.notes.filter(n=>n.gimmick==='slide'&&n.time===259.89546715).map(n=>[n.lane,n.path?.map(p=>p.lane)])).toEqual([[0,[1,2]],[5,[4,3]]]);
  for(const raw of midi.notes.filter(n=>n.pitch<50)) {
    const time=Number((midi.secondsAt(raw.tick)+3.03).toFixed(9));
    const note=chart.notes.find(n=>n.time===time&&n.lane===config.lanes[raw.pitch]&&!n.gimmick)!;
    expect(note).toBeDefined();expect(note.type).toBe(raw.endTick-raw.tick>=1.5*midi.ppq?'hold':'tap');
  }
});
it('plays the entire shipped chart with 770 perfect results including authored slides and single-score boxes',()=>{
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
  expect(engine.finished).toBe(true);expect(engine.counts).toEqual({PERFECT:770,GREAT:0,GOOD:0,MISS:0});
  expect(engine.score).toBe(770000);expect(engine.combo).toBe(770);
});
