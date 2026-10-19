import {afterEach,expect,it,vi} from 'vitest';
import {playbackSession} from '../src/audio-session';
afterEach(()=>vi.unstubAllGlobals());
it('selects playback only when acquired and restores the previous category after the last owner',()=>{
  const audioSession={type:'ambient'};vi.stubGlobal('navigator',{audioSession});
  const game=playbackSession(),preview=playbackSession();expect(audioSession.type).toBe('ambient');
  game.acquire();game.acquire();preview.acquire();expect(audioSession.type).toBe('playback');
  game.release();expect(audioSession.type).toBe('playback');
  preview.release();expect(audioSession.type).toBe('ambient');
  preview.release();expect(audioSession.type).toBe('ambient');
});
it('reasserts playback after a media change and preserves unrelated external changes on release',()=>{
  const audioSession={type:'auto'};vi.stubGlobal('navigator',{audioSession});
  const game=playbackSession();game.acquire();audioSession.type='ambient';game.acquire();expect(audioSession.type).toBe('playback');
  audioSession.type='play-and-record';game.release();expect(audioSession.type).toBe('play-and-record');
});
it('falls back when the optional API is missing or rejects playback',()=>{
  vi.stubGlobal('navigator',{});const absent=playbackSession();expect(()=>{absent.acquire();absent.release();}).not.toThrow();
  let writes=0;vi.stubGlobal('navigator',{audioSession:{get type(){return 'auto';},set type(_type){writes++;throw new Error('unsupported');}}});
  const blocked=playbackSession();expect(()=>{blocked.acquire();blocked.acquire();blocked.release();}).not.toThrow();expect(writes).toBe(1);
});
