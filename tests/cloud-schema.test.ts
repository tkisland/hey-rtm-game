import { expect, it } from 'vitest';
import { chartJson, parseCloudChart, parseCloudConfig } from '../src/cloud-schema';
import { DEFAULT_SONG } from '../src/songs';
import { emptyChart } from '../src/chart-data';

const chart = {...emptyChart(), notes:[{id:1, lane:0, time:12, type:'tap' as const}]};
const data = () => ({schemaVersion:1, songId:DEFAULT_SONG.id, videoId:DEFAULT_SONG.videoId, revision:1, json:chartJson(chart,DEFAULT_SONG), noteCount:1});
it('accepts only the required public Web SDK configuration fields', () => {
  const config = {apiKey:'public-web-key', authDomain:'sample-project.firebaseapp.com', projectId:'sample-project', appId:'1:123:web:abc'};
  expect(parseCloudConfig(JSON.stringify({...config, private_key:'never include this'}))).toEqual(config);
  expect(parseCloudConfig(null)).toBeNull(); expect(parseCloudConfig('')).toBeNull();
  for (const invalid of [{...config,authDomain:'https://example.com/path'},{...config,projectId:'../other-project'},{...config,apiKey:''}]) expect(() => parseCloudConfig(invalid)).toThrow();
});
it('validates saved charts independently of displayed metadata or HTML', () => {
  expect(parseCloudChart(data(),DEFAULT_SONG,true)).toMatchObject({revision:1,chart:{notes:chart.notes}});
  for (const bad of [{...data(),videoId:'abcdefghijk'},{...data(),songId:'other'},{...data(),revision:0},{...data(),revision:Infinity},{...data(),noteCount:2},{...data(),json:'<script>alert(1)</script>'}]) {
    expect(() => parseCloudChart(bad,DEFAULT_SONG)).toThrow();
  }
});
it('allows empty drafts but refuses an empty publication', () => {
  const json = chartJson(emptyChart(),DEFAULT_SONG);
  expect(parseCloudChart({...data(),json,noteCount:0},DEFAULT_SONG).chart.notes).toHaveLength(0);
  expect(() => parseCloudChart({...data(),json,noteCount:0},DEFAULT_SONG,true)).toThrow();
});
it('applies the cloud limit to UTF-8 bytes and refuses unsupported revisions', () => {
  expect(() => parseCloudChart({...data(),json:'あ'.repeat(270000)},DEFAULT_SONG)).toThrow();
  expect(() => parseCloudChart({...data(),revision:Number.MAX_SAFE_INTEGER+1},DEFAULT_SONG)).toThrow();
});
