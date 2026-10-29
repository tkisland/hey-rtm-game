import {expect,it} from 'vitest';
import {resultShareUrl} from '../src/result-share';
import {DEFAULT_SONG,BISCUIT_CASE} from '../src/songs';

it('shares the selected song, difficulty and formatted result with a public Sakura link',()=>{
  const url=new URL(resultShareUrl(BISCUIT_CASE,'hard',{score:652000,baseScore:600000,maxCombo:328,skipped:0}));
  expect(url.origin+url.pathname).toBe('https://twitter.com/intent/tweet');
  expect(url.searchParams.get('text')!.split('\n').slice(0,-1).join('\n')).toBe('#HeyRhythm\nレスが届いたLIVE！\nビスケットケース / むずかしい\nSCORE：652,000\nMAX COMBO：328');
  const shared=new URL(url.searchParams.get('text')!.split('\n').at(-1)!);
  expect(shared.origin+shared.pathname).toBe('https://hey.jpn.org/rhythm/share.php');
  expect(Object.fromEntries(shared.searchParams)).toEqual({song:'biscuit-case',difficulty:'hard',v:'6',art:'2',score:'652000',base:'600000',combo:'328',skipped:'0'});
  expect([...url.searchParams.keys()]).toEqual(['text']);
  expect(url.searchParams.get('text')!.split('\n')).toHaveLength(6);
  expect(url.searchParams.get('text')).not.toMatch(/#HeyMommy|#HEY_RHYTHM/i);
});
it('labels skipped notes and safely encodes Japanese and special characters without mixing query parameters',()=>{
  const song={...DEFAULT_SONG,title:'テスト & #ライブ? / 曲'};
  const url=new URL(resultShareUrl(song,'normal',{score:0,baseScore:0,maxCombo:0,skipped:1500}));
  expect(url.searchParams.get('text')).toContain('テスト & #ライブ? / 曲 / ふつう');
  expect(url.searchParams.get('text')).toContain('シークでスキップ：1,500ノーツ');
  expect(new URL(url.searchParams.get('text')!.split('\n').at(-1)!).searchParams.get('song')).toBe('super-mommy-girls');
  expect([...url.searchParams.keys()]).toEqual(['text']);
});
