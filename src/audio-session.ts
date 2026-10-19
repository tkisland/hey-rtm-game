interface AudioSession { type:string }
interface Owners { previous:string; owners:Set<symbol> }
const sessions = new WeakMap<AudioSession,Owners>();

/** Share iOS's playback category across game, editor and calibration outputs. */
export function playbackSession(): {acquire():void;release():void} {
  let session:AudioSession|undefined;
  try { session = (navigator as Navigator & {audioSession?:AudioSession}).audioSession; } catch { /* Optional API. */ }
  const owner = Symbol('note-audio');
  let failed = false;
  return {
    acquire() {
      if (!session || failed) return;
      try {
        const owners = sessions.get(session) ?? {previous:session.type,owners:new Set<symbol>()};
        // A media player can change the category after our context was created.
        if (session.type !== 'playback') session.type = 'playback';
        owners.owners.add(owner); sessions.set(session,owners);
      } catch { failed = true; }
    },
    release() {
      if (!session) return;
      const owners = sessions.get(session);
      if (!owners || !owners.owners.delete(owner) || owners.owners.size) return;
      sessions.delete(session);
      try { if (session.type === 'playback') session.type = owners.previous; } catch { /* Optional API. */ }
    },
  };
}
