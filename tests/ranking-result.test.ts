import {expect,it} from 'vitest';
import {normalizeRankingName,rankingBoard,chartHash} from '../src/ranking-api';
import {GameEngine} from '../src/engine';
import {DEFAULT_SONG} from '../src/songs';

it('normalizes only three to six ASCII alphanumeric characters, without treating a name as an account',()=>{
  expect(normalizeRankingName('abc')).toBe('ABC');expect(normalizeRankingName('ab12')).toBe('AB12');expect(normalizeRankingName('abc12')).toBe('ABC12');expect(normalizeRankingName('ABC123')).toBe('ABC123');
  for(const value of ['','AB','ABCDEFG','ＡＢＣ１２','あいうえお','AB CD',"AB'CD",'ABC12\n'])expect(normalizeRankingName(value)).toBeNull();
});
it('hashes the exact authoritative JSON and separates changed content',async()=>{
  expect(await chartHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(await chartHash('{"notes":[]}')).not.toBe(await chartHash('{"notes":[],"title":"new"}'));
  expect(rankingBoard('song','normal','hash')).toEqual({songId:'song',difficulty:'normal',chartHash:'hash',rulesVersion:1});
});
it('exports final judgement completion order once and clears it when starting another play',()=>{
  const engine=new GameEngine({videoId:DEFAULT_SONG.videoId,title:'ranking',bpm:120,startTime:1,notes:[
    {id:1,time:1,lane:0,type:'hold',endTime:3},{id:2,time:2,lane:1,type:'tap'},
  ]});
  engine.input(0,1);expect(engine.rankingJudgements()).toEqual([]);
  engine.input(1,2);engine.release(0,3);
  expect(engine.rankingJudgements()).toEqual([{id:2,judgement:'PERFECT'},{id:1,judgement:'PERFECT'}]);
  const snapshot=engine.rankingJudgements();snapshot[0].judgement='MISS';
  expect(engine.rankingJudgements()[0].judgement).toBe('PERFECT');
  engine.reset();expect(engine.rankingJudgements()).toEqual([]);
});
