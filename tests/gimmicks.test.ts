import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convertMidi, MIDI_LANES } from '../src/midi';
import { parseChart, copyChart, EditorModel } from '../src/editor-model';
import { EditorPreview } from '../src/editor-preview';
import { tutorialChart } from '../src/tutorial-chart';
import { BOX_WINDOWS, BOX_SWEEP_SECONDS, GameEngine, playLane } from '../src/engine';
import { chordGroups, playableNotes } from '../src/note-display';
import { VIDEO_ID } from '../src/chart';
import type { Chart, ChartNote } from '../src/chart';
import { chartJson, parseCloudChart } from '../src/cloud-schema';
import { DEFAULT_SONG } from '../src/songs';

const chart = (notes: ChartNote[]): Chart => ({videoId:VIDEO_ID, title:'推しノーツ', bpm:120, startTime:1, beatOrigin:0, notes});
const slide = (): ChartNote => ({id:1, type:'hold', gimmick:'slide', time:1, endTime:4, lane:0, path:[{time:2,lane:1},{time:3,lane:2}]});
const box = () => chart(Array.from({length:6}, (_,lane) => ({id:lane + 1,type:'tap',gimmick:'box',boxId:1,time:lane + 1,lane})));
const sample = readFileSync(new URL('../charts/source/oshi-gimmicks.mid', import.meta.url));
const config = {videoId:VIDEO_ID, title:'推しノーツ', offsetSeconds:7.65, lanes:MIDI_LANES};

describe('DD and box play', () => {
  it('allows any one lane to score DD exactly once, with feedback on the played lane', () => {
    for (let lane=0;lane<6;lane++) {
      const engine = new GameEngine(chart([{id:1,type:'tap',gimmick:'dd',time:1,lane:2}]));
      expect(engine.input(lane,1)).toMatchObject({judgement:'PERFECT',lane});
      for (let second=0;second<6;second++) expect(engine.input(second,1)).toBeNull();
      expect(engine.baseScore).toBe(Math.floor(1000 * 1000 / engine.notes.length)); expect(engine.combo).toBe(1);
    }
  });
  it('gives matching ordinary notes priority over DD without forming a chord with it', () => {
    const data = chart([{id:1,type:'tap',gimmick:'dd',time:1,lane:2},{id:2,type:'tap',time:1,lane:3}]);
    const engine = new GameEngine(data);
    expect(chordGroups(data.notes)).toEqual([]);
    expect(engine.input(3,1)?.noteId).toBe(2); expect(engine.baseScore).toBe(Math.floor(1000 * 1000 / engine.notes.length));
    expect(engine.input(0,1)?.noteId).toBe(1); expect(engine.baseScore).toBe(Math.floor(2000 * 1000 / engine.notes.length));
  });
  it('scores two distinct fingers opening from the center in either starting order exactly once', () => {
    for(const order of [[2,3,1,4,0,5],[3,2,4,1,5,0]]) {
      const engine=new GameEngine(box());
      order.forEach((lane,i)=>{
        const hit=engine.input(lane,1+Math.floor(i/2)*.04,{id:lane<3?'left':'right'});
        expect(hit?.boxStep).toBe(i+1);expect(engine.baseScore).toBe(i===5?1000000:0);
      });
      expect(engine.counts).toEqual({PERFECT:1,GREAT:0,GOOD:0,MISS:0});
      expect(engine.combo).toBe(1);expect(engine.finished).toBe(true);
      expect(engine.input(5,1.1,{id:'right'})).toBeNull();
    }
  });
  it('keeps broad start windows and accepts both hands finishing 350ms after starting', () => {
    for(const [error,grade,points] of [[-.35,'GOOD',500],[-.25,'GREAT',700],[.15,'PERFECT',1000],[.35,'GOOD',500]] as const) {
      const engine=new GameEngine(box());
      [2,3,1,4,0,5].forEach((lane,i)=>{
        const time=1+error+Math.floor(i/2)*BOX_SWEEP_SECONDS/2;
        engine.advance(time);expect(engine.input(lane,time)?.judgement).toBe(grade);
      });
      expect(engine.baseScore).toBe(Math.floor(points * 1000 / engine.notes.length));expect(engine.combo).toBe(1);
    }
    for(const error of [-.3501,.3501])expect(new GameEngine(box()).input(2,1+error)).toBeNull();
  });
  it('rejects a single finger, old edge-to-edge sweeps, inward moves and reversal', () => {
    for(const lanes of [[2,3,1,4,0,5],[0,1,2,3,4,5],[5,4,3,2,1,0],[2,3,1,4,2,5]]) {
      const engine=new GameEngine(box());
      lanes.forEach((lane,i)=>engine.input(lane,1+i*.02,{id:lanes[0]===2&&lanes[4]===0?'one':lane<3?'left':'right'}));
      engine.advance(2);expect(engine.baseScore).toBe(0);expect(engine.counts.MISS).toBe(1);
    }
  });
  it('requires nearly simultaneous central contacts and an outward gesture within the deadline', () => {
    const late=new GameEngine(box());late.input(2,1,{id:'left'});
    expect(late.input(3,1.1501,{id:'right'})).toBeNull();
    late.input(1,1.2,{id:'left'});late.input(0,1.25,{id:'left'});late.advance(2);
    expect(late.baseScore).toBe(0);expect(late.counts.MISS).toBe(1);
    const slow=new GameEngine(box());[2,3,1,4,0,5].forEach((lane,i)=>slow.input(lane,1+i*.08));
    slow.advance(2);expect(slow.baseScore).toBe(0);expect(slow.counts.MISS).toBe(1);
    const edge=new GameEngine(box());edge.input(2,1);expect(edge.input(3,1.15)?.phase).toBe('sweep');
  });
  it('cancels partial lifts, allows a new attempt and lets a completed hand lift after both have joined', () => {
    const engine=new GameEngine(box());engine.input(2,.75,{id:'left'});engine.input(3,.75,{id:'right'});
    engine.cancelBoxGesture('left');expect(engine.notes[0].boxProgress).toBeUndefined();
    [2,3,1,4,0,5].forEach(lane=>engine.input(lane,1,{id:lane<3?'left2':'right2'}));
    expect(engine.baseScore).toBe(Math.floor(1000 * 1000 / engine.notes.length)); // A cancelled attempt cannot retain its worse grade.
    const lifted=new GameEngine(box());
    lifted.input(2,1,{id:'left'});lifted.input(3,1,{id:'right'});
    lifted.input(1,1.04,{id:'left'});lifted.input(0,1.08,{id:'left'});lifted.cancelBoxGesture('left');
    lifted.input(4,1.1,{id:'right'});lifted.input(5,1.12,{id:'right'});expect(lifted.baseScore).toBe(Math.floor(1000 * 1000 / lifted.notes.length));
    const single=new GameEngine(box());[2,1,0].forEach((lane,i)=>single.input(lane,1+i*.02,{id:'first'}));
    single.cancelBoxGesture('first');expect(single.input(3,1.08,{id:'second'})).toBeNull();
    single.advance(2);expect(single.baseScore).toBe(0);
  });
  it('expires and seeks a box only once and never lets interpolated crossings hit ordinary notes', () => {
    const engine=new GameEngine(box());engine.input(2,1);engine.cancelBoxGesture('keyboard');
    expect(engine.notes[0].boxProgress).toBeUndefined();engine.advance(1.351);engine.advance(5);
    expect(engine.counts.MISS).toBe(1);engine.reset();engine.seek(1.2,false);expect(engine.skipped).toBe(0);
    engine.seek(1.4,false);expect(engine.skipped).toBe(1);engine.seek(0,true);expect(engine.notes[0].boxHands).toBeUndefined();
    for(const gimmick of [undefined,'dd'] as const) {
      const ordinary=new GameEngine(chart([{id:1,type:'tap',lane:2,time:1,gimmick}]));
      expect(ordinary.input(2,1,{id:'finger',sweepOnly:true})).toBeNull();expect(ordinary.baseScore).toBe(0);
      expect(ordinary.input(2,1)?.judgement).toBe('PERFECT');
    }
  });
  it('keeps independent boxes and previews one arpeggio per anchor without seek backlogs', () => {
    const data=box();data.notes.push(...box().notes.map(note=>({...note,id:note.id+6,boxId:2,time:note.time+1})));
    data.notes.reverse();const engine=new GameEngine(data);
    for(const time of [1,2])for(const lane of [2,3,1,4,0,5])engine.input(lane,time);
    expect(engine.baseScore).toBe(Math.floor(2000 * 1000 / engine.notes.length));expect(engine.combo).toBe(2);
    const tutorial=tutorialChart(3),preview=new EditorPreview();preview.sync(tutorial);preview.seek(tutorial.startTime-.1);
    expect(preview.update(tutorial.startTime,true)).toEqual([expect.objectContaining({boxStep:6,boxComplete:true})]);
    expect(preview.update(tutorial.startTime+.1,true)).toEqual([]);preview.seek(0);expect(preview.update(4,true)).toEqual([]);
  });
});

describe('slide gestures', () => {
  it('imports, saves and plays a distant purple-to-pink transfer as one hold', () => {
    const bytes=Buffer.from(sample);
    for (const status of [0x90,0x80]) for (const [from,to] of [[62,69],[64,62]]) {
      const at=bytes.indexOf(Buffer.from([status,from,status===0x90?100:0])); bytes[at+1]=to;
    }
    const imported=convertMidi(bytes,config), note=imported.notes.find(note=>note.gimmick==='slide')!;
    expect(note).toMatchObject({lane:4,path:[{time:23.65,lane:0},{time:24.65,lane:2}]});
    expect(parseChart(JSON.stringify(imported),true)).toEqual(imported);
    const model=new EditorModel(imported); model.selected=note.id;
    model.setSlidePath([{time:23.65,lane:5},{time:24.65,lane:0}]);
    expect(model.selectedNote?.path?.map(point=>point.lane)).toEqual([5,0]); model.undo();
    const engine=new GameEngine(chart([{...note,id:1}]));
    engine.advance(note.time,new Set([4])); engine.input(4,note.time);
    expect(engine.nextSlideLane(4)).toBe(0);
    engine.advance(23.65,new Set([0])); expect(engine.nextSlideLane(0)).toBe(2);
    engine.advance(24.65,new Set([2])); expect(engine.release(2,25.65)[0].judgement).toBe('PERFECT');
    expect(engine.baseScore).toBe(Math.floor(1000 * 1000 / engine.notes.length)); expect(engine.combo).toBe(1);
  });
  it('transfers a captured finger atomically and scores only at a successful final release', () => {
    const engine = new GameEngine(chart([slide()]));
    engine.advance(1,new Set([0])); expect(engine.input(0,1)?.phase).toBe('start');
    expect(engine.advance(2,new Set([1]))).toEqual([expect.objectContaining({lane:1,phase:'move',judgement:'PERFECT'})]);
    expect(engine.release(0,2)).toEqual([]); expect(playLane(engine.notes[0])).toBe(1);
    expect(engine.advance(3,new Set([2]))[0].phase).toBe('move');
    expect(engine.baseScore).toBe(0); expect(engine.combo).toBe(0);
    expect(engine.release(2,4)[0].judgement).toBe('PERFECT');
    expect(engine.baseScore).toBe(Math.floor(1000 * 1000 / engine.notes.length)); expect(engine.combo).toBe(1); expect(engine.finished).toBe(true);
  });
  it('allows overlapping adjacent keyboard keys and uses the worst checkpoint judgement', () => {
    const engine = new GameEngine(chart([slide()])); engine.input(0,1);
    engine.advance(2.12,new Set([0,1])); expect(engine.release(0,2.13)).toEqual([]);
    engine.advance(2.5,new Set([1])); engine.advance(3,new Set([1,2])); engine.release(1,3);
    expect(engine.release(2,4)[0].judgement).toBe('GREAT'); expect(engine.baseScore).toBe(Math.floor(700 * 1000 / engine.notes.length));
  });
  it('fails when released early, at a missed checkpoint, or after holding past the tail', () => {
    for (const mode of ['release','checkpoint','tail']) {
      const engine = new GameEngine(chart([slide()])); engine.input(0,1);
      if (mode==='release') engine.release(0,1.5);
      if (mode==='checkpoint') engine.advance(2.2501,new Set([0]));
      if (mode==='tail') {engine.advance(2,new Set([1]));engine.advance(3,new Set([2]));engine.advance(4.2501,new Set([2]));}
      expect(engine.baseScore).toBe(0); expect(engine.counts.MISS).toBe(1); expect(engine.finished).toBe(true);
      engine.advance(5,new Set()); expect(engine.counts.MISS).toBe(1);
    }
  });
  it('does not accept a next key held too early or a skipped intermediate lane', () => {
    const engine = new GameEngine(chart([slide()])); engine.input(0,1);
    engine.advance(1.5,new Set([0,1])); engine.advance(2,new Set([0,1])); engine.advance(2.2501,new Set([0,1]));
    expect(engine.counts.MISS).toBe(1); expect(engine.baseScore).toBe(0);
    engine.reset(); engine.input(0,1); engine.advance(2,new Set([2])); expect(engine.counts.MISS).toBe(1);
  });
  it('resets accepted checkpoints and preserves original chart paths during a seek', () => {
    const data = chart([slide()]), engine = new GameEngine(data); engine.input(0,1);engine.advance(2,new Set([1]));
    engine.seek(3,false); expect(engine.notes[0].state).toBe('skipped');
    engine.seek(0,true); expect(engine.notes[0].pathIndex).toBeUndefined();
    engine.notes[0].path![0].time=99; expect(data.notes[0].path![0].time).toBe(2);
  });
  it.each([[-.2501,'MISS'],[-.25,'GOOD'],[-.18,'GREAT'],[-.1,'PERFECT'],[.1,'PERFECT'],[.1001,'GREAT'],[.18,'GREAT'],[.1801,'GOOD'],[.25,'GOOD'],[.2501,'MISS']] as const)('accepts a distant checkpoint at %ss only inside the extended window', (error, judgement) => {
    const note = slide(); note.path = [{time:2,lane:5}];
    const engine = new GameEngine(chart([note]));
    engine.advance(1,new Set([0])); engine.input(0,1);
    const hits = engine.advance(2+error,new Set([5]));
    expect(hits[0].judgement).toBe(judgement);
    if (judgement !== 'MISS') {
      expect(hits[0]).toMatchObject({phase:'move',lane:5});
      expect(engine.baseScore).toBe(0); expect(engine.combo).toBe(0);
      expect(engine.release(5,4)[0].judgement).toBe(judgement);
    }
    expect(engine.counts[judgement]).toBe(1);
    engine.advance(5,new Set()); expect(Object.values(engine.counts).reduce((a,b)=>a+b,0)).toBe(1);
  });
  it('does not apply the wider hold windows to taps, DD or slide starts', () => {
    for (const note of [{id:1,type:'tap' as const,time:1,lane:0},{id:1,type:'tap' as const,gimmick:'dd' as const,time:1,lane:0},slide()]) {
      const engine = new GameEngine(chart([note]));
      expect(engine.input(0,.8)).toBeNull();
      engine.advance(1.1601,new Set()); expect(engine.counts.MISS).toBe(1);
    }
  });
});

describe('MIDI, persistence and editor', () => {
  it('imports the example in the same channel with offset, six box taps, two DD and one slide', () => {
    const data = convertMidi(new Uint8Array(sample),config);
    expect(data.startTime).toBe(9.65);
    expect(data.notes.filter(note => note.gimmick==='box')).toHaveLength(6);
    expect(new Set(data.notes.filter(note => note.gimmick==='box').map(note=>note.time)).size).toBe(1);
    expect(data.notes.filter(note => note.gimmick==='dd')).toHaveLength(2);
    expect(data.notes.find(note => note.gimmick==='slide')).toMatchObject({time:22.65,endTime:25.65,lane:0,path:[{time:23.65,lane:1},{time:24.65,lane:2}]});
    expect(parseChart(JSON.stringify(data),true)).toEqual(data);
    expect(() => convertMidi(sample,{...config,lanes:{...MIDI_LANES,60:0}})).toThrow('Reserved');
  });
  it('rejects malformed special MIDI instead of dropping or reclassifying notes', () => {
    const mutate = (pitch: number, replacement: number) => { const bytes=Buffer.from(sample); for (const status of [0x90,0x80]) {const at=bytes.indexOf(Buffer.from([status,pitch,status === 0x90 ? 100 : 0]));bytes[at + 1]=replacement;}return bytes; };
    expect(() => convertMidi(mutate(50,52),config)).toThrow('箱オシ');
    expect(() => convertMidi(mutate(65,64),config)).toThrow('別の色');
    expect(() => convertMidi(mutate(65,47),config)).not.toThrow(); // Shorter valid slide, followed by an ordinary hold.
    expect(() => convertMidi(mutate(62,38),config)).not.toThrow(); // Ordinary hold, then a valid two-segment slide.
    const bytes=mutate(64,40);expect(() => convertMidi(bytes,config)).toThrow('2〜129');
  });
  it('rejects malformed box groups, mismatched gimmicks and repeated/unsorted paths', () => {
    const invalid: Chart[] = [box(),box(),chart([slide()]),chart([slide()]),chart([slide()]),chart([slide()])];
    invalid[0].notes.pop();invalid[1].notes[1].lane=0;
    invalid[2].notes[0].path![0].lane=0;invalid[3].notes[0].path![1].time=1.5;
    invalid[4].notes[0].gimmick='dd';invalid[5].notes[0].path![1].time=4;
    for (const data of invalid) expect(() => parseChart(JSON.stringify(data))).toThrow();
  });
  it('deep copies paths, remaps pasted box IDs and keeps undo independent of later edits', () => {
    const data = chart([...box().notes,{...slide(),id:7,time:7,endTime:10,path:[{time:8,lane:1},{time:9,lane:2}]}]);
    const model = new EditorModel(data); const clip = model.copyRange({start:0,end:11}); model.pasteRange(clip,11);
    expect(model.chart.notes.filter(note => note.gimmick==='box').map(note => note.boxId)).toEqual([1,1,1,1,1,1,2,2,2,2,2,2]);
    expect(model.chart.notes.find(note => note.id===14)?.path).toEqual([{time:19,lane:1},{time:20,lane:2}]);
    model.move(14,19,1); expect(model.chart.notes.find(note => note.id===14)?.path).toEqual([{time:20,lane:2},{time:21,lane:3}]);
    model.undo(); expect(model.chart.notes.find(note => note.id===14)?.path![0]).toEqual({time:19,lane:1}); expect(clip.notes[6].path![0].time).toBe(8);
    const copy=copyChart(data);copy.notes[6].path![0].time=999;expect(data.notes[6].path![0].time).toBe(8);
  });
  it('copies and deletes whole boxes by anchor, while changing their type dissolves the markers', () => {
    const model=new EditorModel(box());const partial=model.copyRange({start:1,end:3});expect(partial.notes.every(note => note.gimmick==='box')).toBe(true);
    expect(partial.notes).toHaveLength(6);expect(new Set(partial.notes.map(note=>note.time))).toEqual(new Set([1]));
    expect(model.pasteRange(partial,10)).toBe(1);model.undo();
    model.selected=1;model.remove();expect(model.chart.notes.every(note => !note.gimmick)).toBe(true);
    model.undo();model.selected=1;model.changeType('dd');expect(model.chart.notes.slice(1).every(note => !note.gimmick)).toBe(true);
    model.undo();expect(model.removeRange({start:1,end:2})).toBe(1);expect(model.chart.notes).toHaveLength(0);
  });
  it('supports manual DD/slide/box editing and refuses invalid path edits atomically', () => {
    const model=new EditorModel(chart([{id:1,type:'tap',time:1,lane:0}]));model.selected=1;
    model.changeType('dd');expect(model.selectedNote?.gimmick).toBe('dd');model.changeType('slide',4);
    model.setSlidePath([{time:2,lane:1},{time:3,lane:2}]);const before=JSON.stringify(model.chart);
    expect(() => model.resize(1,2)).toThrow();expect(JSON.stringify(model.chart)).toBe(before);
    expect(() => model.setSlidePath([{time:2,lane:0}])).toThrow();expect(JSON.stringify(model.chart)).toBe(before);
    const base=box();base.notes.forEach(note => {delete note.gimmick;delete note.boxId;});model.replace(base);model.boxRange({start:1,end:7});expect(model.chart.notes.every(note => note.gimmick==='box')).toBe(true);
  });
  it('edits, quantizes, removes and undoes one box as a complete unit', () => {
    const data=box();data.notes.forEach(note=>{note.time+=.07;delete note.gimmick;delete note.boxId;});
    const model=new EditorModel(data);model.boxRange({start:1,end:7});
    expect(new Set(model.chart.notes.map(note=>note.time))).toEqual(new Set([1.07]));
    model.selected=3;model.quantize(4,true,false);
    expect(new Set(model.chart.notes.map(note=>note.time))).toEqual(new Set([1.125]));
    model.move(3,2,4);expect(new Set(model.chart.notes.map(note=>note.time))).toEqual(new Set([2]));
    expect(new Set(model.chart.notes.map(note=>note.lane)).size).toBe(6);
    const before=JSON.stringify(model.chart);expect(()=>model.move(3,7201,0)).toThrow();expect(JSON.stringify(model.chart)).toBe(before);
    model.remove();expect(model.chart.notes).toHaveLength(0);model.undo();expect(playableNotes(model.chart.notes)).toHaveLength(1);
  });
  it('autoplays slide changes on the preview clock and suppresses seek backlogs', () => {
    const preview=new EditorPreview();preview.sync(chart([slide()]));preview.seek(.9);
    expect(preview.update(1,true)[0]).toMatchObject({lane:0,phase:'start'});
    preview.update(1.8,true);expect(preview.update(2,true)[0]).toMatchObject({lane:1,phase:'move'});expect(playLane(preview.notes[0])).toBe(1);
    preview.seek(3.8);expect(preview.update(4,true)[0]).toMatchObject({lane:2,phase:'end'});
    preview.seek(0);expect(preview.update(3.5,true)).toEqual([]);
  });
  it('validates every tutorial chart and retains all new data through public canonicalization', () => {
    for(let step=0;step<6;step++) {
      const data=tutorialChart(step), json=chartJson(data,DEFAULT_SONG,true);
      const stored=parseCloudChart({schemaVersion:1,songId:DEFAULT_SONG.id,videoId:VIDEO_ID,json,revision:1,noteCount:data.notes.length},DEFAULT_SONG,true);
      expect(stored.chart.notes).toEqual(data.notes);
    }
  });
});

it('accepts a prepared adjacent key only when the current key is released at the checkpoint', () => {
  const engine = new GameEngine(chart([slide()]));
  engine.advance(1,new Set([0]));engine.input(0,1);
  expect(engine.advance(1.5,new Set([0,1]))).toEqual([]);
  expect(playLane(engine.notes[0])).toBe(0);
  expect(engine.advance(2,new Set([1]))).toEqual([expect.objectContaining({phase:'move',lane:1,judgement:'PERFECT'})]);
  engine.advance(2.5,new Set([1,2]));engine.advance(3,new Set([2]));engine.release(2,4);
  expect(engine.baseScore).toBe(Math.floor(1000 * 1000 / engine.notes.length));expect(engine.counts.PERFECT).toBe(1);
});

it('still fails an early release onto a prepared key and never transfers from holding all keys alone', () => {
  const engine = new GameEngine(chart([slide()]));engine.advance(1,new Set([0]));engine.input(0,1);
  engine.advance(1.5,new Set([0,1]));engine.advance(1.6,new Set([1]));
  expect(engine.counts.MISS).toBe(1);expect(engine.baseScore).toBe(0);
});
