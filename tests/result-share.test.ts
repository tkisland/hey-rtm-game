import {expect,it} from 'vitest';
import {resultShareUrl} from '../src/result-share';
import {DEFAULT_SONG,BISCUIT_CASE} from '../src/songs';

it('shares the selected song, difficulty and formatted result with a public Sakura link',()=>{
  const url=new URL(resultShareUrl(BISCUIT_CASE,'hard',{score:652000,baseScore:600000,maxCombo:328,skipped:0}));
  expect(url.origin+url.pathname).toBe('https://twitter.com/intent/tweet');
  expect(url.searchParams.get('text')).toBe('レスが届いたLIVE！\nビスケットケース / むずかしい\nSCORE：652,000\nMAX COMBO：328');
  const shared=new URL(url.searchParams.get('url')!);
  expect(shared.origin+shared.pathname).toBe('https://hey.jpn.org/rhythm/share.php');
  expect(Object.fromEntries(shared.searchParams)).toEqual({song:'biscuit-case',difficulty:'hard',v:'4',score:'652000',base:'600000',combo:'328',skipped:'0'});
  expect(url.searchParams.get('hashtags')).toBe('HeyMommy,HEY_RHYTHM');
});
it('labels skipped notes and safely encodes Japanese and special characters without mixing query parameters',()=>{
  const song={...DEFAULT_SONG,title:'テスト & #ライブ? / 曲'};
  const url=new URL(resultShareUrl(song,'normal',{score:0,baseScore:0,maxCombo:0,skipped:1500}));
  expect(url.searchParams.get('text')).toContain('テスト & #ライブ? / 曲 / ふつう');
  expect(url.searchParams.get('text')).toContain('シークでスキップ：1,500ノーツ');
  expect(new URL(url.searchParams.get('url')!).searchParams.get('song')).toBe('super-mommy-girls');
  expect([...url.searchParams.keys()]).toEqual(['text','url','hashtags']);
});
