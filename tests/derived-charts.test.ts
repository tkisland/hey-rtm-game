import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {SONGS} from '../src/songs';
import {bundledChart} from '../src/bundled-charts';
import {playableNotes,chordGroups} from '../src/note-display';
import {parseChart} from '../src/chart-data';
import {easyChart,hardChart} from '../scripts/lib/difficulty-authoring';
import {autoplayChart} from './chart-autoplay';

const counts={'super-mommy-girls':{easy:275,normal:510,hard:893},'biscuit-case':{easy:393,normal:753,hard:998}};
const hashes={'super-mommy-girls':'907b0758caedaf6bddcd0109f5c9a7fd5cde0addfb18c146592f1d5916fa76e6','biscuit-case':'dbfbc349b6a51e973911544b73ada967415982bfdd0628252afa46742a3f3cec'};
for(const song of SONGS) {
  const normal=bundledChart(song)!;
  it(`${song.id} preserves the complete normal source and produces reproducible independent static levels`,()=>{
    expect(createHash('sha256').update(readFileSync(`src/charts/${song.chartId}.json`)).digest('hex')).toBe(hashes[song.id as keyof typeof hashes]);
    for(const [level,derive] of [['easy',easyChart],['hard',hardChart]] as const) {
      const chart=bundledChart(song,level)!;
      expect(parseChart(JSON.stringify(derive(normal)),true,song)).toEqual(chart);
      expect(chart.bpm).toBe(normal.bpm);expect(chart.beatOrigin).toBe(normal.beatOrigin);expect(chart.tempoChanges).toEqual(normal.tempoChanges);
      expect(chart.startTime).toBe(normal.startTime);
      expect(Math.max(...playableNotes(chart.notes).map(n=>n.type==='hold'?n.endTime:n.time))).toBe(Math.max(...playableNotes(normal.notes).map(n=>n.type==='hold'?n.endTime:n.time)));
      chart.notes[0].lane=(chart.notes[0].lane+1)%6;expect(bundledChart(song,level)!.notes[0].lane).not.toBe(chart.notes[0].lane);
    }
  });
  it(`${song.id} easy reduces density, bounds hold length and removes complex gestures`,()=>{
    const easy=bundledChart(song,'easy')!,notes=playableNotes(easy.notes),source=new Map(normal.notes.map(n=>[n.id,n]));
    expect(notes.length).toBeLessThan(playableNotes(normal.notes).length*.6);
    expect(notes.every(n=>!['box','slide'].includes(n.gimmick!))).toBe(true);
    expect(new Set(notes.map(n=>n.lane)).size).toBe(6);
    for(const n of notes){expect(n.time).toBe(source.get(n.id)!.time);if(n.type==='hold')expect(n.endTime).toBeLessThanOrEqual((source.get(n.id)! as any).endTime);}
    for(const chord of chordGroups(notes)){expect(chord.length).toBe(2);expect(new Set(chord.map(n=>n.lane<3)).size).toBe(2);}
  });
  it(`${song.id} hard preserves every authored note and leaves space for holds, swipes and each thumb`,()=>{
    const hard=bundledChart(song,'hard')!,source=new Map(normal.notes.map(n=>[n.id,n])),all=playableNotes(hard.notes);
    for(const n of normal.notes)expect(hard.notes.find(x=>x.id===n.id)).toEqual(n);
    expect(all.length).toBeGreaterThan(playableNotes(normal.notes).length*1.25);
    for(const n of all.filter(n=>!source.has(n.id))) {
      expect(n.type).toBe('tap');expect(n.gimmick).toBeUndefined();
      for(const old of playableNotes(normal.notes)) {
        if(old.type==='hold')expect(n.time<old.time-.18||n.time>old.endTime+.2).toBe(true);
        if(old.gimmick==='box')expect(Math.abs(n.time-old.time)).toBeGreaterThanOrEqual(.6);
      }
      for(const other of all.filter(x=>x.id!==n.id&&x.type==='tap'&&!x.gimmick)) {
        if(n.lane===other.lane)expect(Math.abs(n.time-other.time)).toBeGreaterThanOrEqual(.18-1e-8);
        if((n.lane<3)===(other.lane<3))expect(Math.abs(n.time-other.time)).toBeGreaterThanOrEqual(.115-1e-8);
      }
    }
    expect(chordGroups(all).every(group=>group.length<=2)).toBe(true);
  });
  for(const level of ['easy','normal','hard'] as const)it(`${song.id} ${level} can be played to the end with every note PERFECT`,()=>{
    const game=autoplayChart(bundledChart(song,level)!);
    expect(game.notes).toHaveLength(counts[song.id as keyof typeof counts][level]);
    expect(game.counts).toEqual({PERFECT:game.notes.length,GREAT:0,GOOD:0,MISS:0});
    expect(game.finished).toBe(true);expect(game.skipped).toBe(0);expect(game.baseScore).toBe(1000000);expect(game.combo).toBe(game.notes.length);
  });
}
