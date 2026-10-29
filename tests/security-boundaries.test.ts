import {it,expect} from 'vitest';
import {parseChart} from '../src/chart-data';
import {EditorModel} from '../src/editor-model';
import {DEFAULT_SONG} from '../src/songs';

it('rejects note IDs outside the PHP integer contract before saving or publishing',()=>{
  const chart={videoId:DEFAULT_SONG.videoId,title:'ID boundary',bpm:120,startTime:1,notes:[{id:2147483647,time:1,lane:0,type:'tap'}]};
  const valid=parseChart(JSON.stringify(chart),true,DEFAULT_SONG);expect(valid.notes[0].id).toBe(2147483647);
  expect(()=>new EditorModel(valid).add(2,1)).toThrow('上限');
  for(const id of [2147483648,Number.MAX_SAFE_INTEGER])expect(()=>parseChart(JSON.stringify({...chart,notes:[{...chart.notes[0],id}]}),true,DEFAULT_SONG)).toThrow();
});
