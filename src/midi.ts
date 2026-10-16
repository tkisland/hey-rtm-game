import type { Chart, ChartNote } from './chart';

export interface MidiConfig { videoId: string; title: string; offsetSeconds: number; lanes: Record<number, number> }
interface MidiNote { tick: number; endTick: number; pitch: number; channel: number; track: number }
interface Tempo { tick: number; tempo: number; seconds: number; track?: number }
export const MIDI_LANES = {38:0,39:0,40:1,41:2,43:3,45:4,47:5};
export const BOX_PITCHES = [50,52,53,55,57,59];
export const DD_PITCH = 60;
export const SLIDE_PITCHES = [62,64,65,67,69,71];

/** Decode SMF 0/1 without guessing note names, lanes, tempo, or missing note-offs. */
export function readMidi(buffer: Uint8Array) {
  let offset = 0;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const need = (count: number, end = buffer.length) => { if (offset + count > end) throw new Error('Truncated MIDI data'); };
  const byte = (end: number) => { need(1, end); return buffer[offset++]; };
  const u16 = () => { need(2); const n = view.getUint16(offset); offset += 2; return n; };
  const u32 = () => { need(4); const n = view.getUint32(offset); offset += 4; return n; };
  const tag = () => { need(4); const s = String.fromCharCode(...buffer.subarray(offset, offset + 4)); offset += 4; return s; };
  const vlq = (end: number) => {
    let result = 0;
    for (let i = 0; i < 4; i++) { const v = byte(end); result = result * 128 + (v & 127); if (!(v & 128)) return result; }
    throw new Error('Invalid MIDI variable-length quantity');
  };
  if (tag() !== 'MThd') throw new Error('Not a Standard MIDI File');
  const headerLength = u32(), headerEnd = offset + headerLength;
  if (headerLength < 6) throw new Error('Invalid MIDI header');
  need(headerLength);
  const format = u16(), trackCount = u16(), ppq = u16();
  if (format > 1 || !trackCount || (format === 0 && trackCount !== 1)) throw new Error('Only SMF format 0/1 is supported');
  if (!ppq || (ppq & 0x8000)) throw new Error('MIDI must use quarter-note tick timing, not SMPTE');
  offset = headerEnd;
  const events: {tick: number; tempo: number; track: number}[] = [], noteEvents: MidiNote[] = [];
  for (let track = 0; track < trackCount; track++) {
    if (tag() !== 'MTrk') throw new Error('Missing MIDI track');
    const length = u32(), end = offset + length;
    need(length);
    let tick = 0, running = 0, ended = false;
    const active = new Map<number, number[]>();
    while (offset < end) {
      tick += vlq(end);
      let status = byte(end);
      if (status < 0x80) { if (!running) throw new Error('Invalid MIDI running status'); offset--; status = running; }
      else if (status < 0xf0) running = status;
      else running = 0;
      if (status === 0xff) {
        const type = byte(end), count = vlq(end); need(count, end);
        if (type === 0x51) {
          if (count !== 3) throw new Error('Invalid MIDI tempo event');
          const tempo = (buffer[offset] * 65536 + buffer[offset + 1] * 256 + buffer[offset + 2]);
          if (!tempo) throw new Error('MIDI tempo cannot be zero');
          events.push({ tick, tempo, track });
        }
        offset += count;
        if (type === 0x2f) { if (count) throw new Error('Invalid end-of-track'); ended = true; offset = end; }
        continue;
      }
      if (status === 0xf0 || status === 0xf7) { const count = vlq(end); need(count, end); offset += count; continue; }
      if (status >= 0xf0) throw new Error('Unsupported MIDI system event');
      const kind = status >> 4, channel = status & 15;
      const a = byte(end), b = kind === 0xc || kind === 0xd ? 0 : byte(end);
      if (a > 127 || b > 127) throw new Error('Invalid MIDI channel data');
      if (kind !== 8 && kind !== 9) continue;
      const key = channel * 128 + a;
      if (kind === 9 && b > 0) {
        const queue = active.get(key) ?? []; queue.push(tick); active.set(key, queue);
      } else {
        const queue = active.get(key);
        if (!queue?.length) throw new Error(`Unmatched note-off: track ${track}, pitch ${a}`);
        const start = queue.shift()!;
        if (tick <= start) throw new Error('MIDI notes must have positive length');
        noteEvents.push({ tick: start, endTick: tick, pitch: a, channel, track });
      }
    }
    if (!ended) throw new Error('Missing end-of-track');
    if ([...active.values()].some(queue => queue.length)) throw new Error(`Missing note-off in track ${track}`);
  }
  if (offset !== buffer.length) throw new Error('Unexpected data after MIDI tracks');
  events.sort((a, b) => a.tick - b.tick || a.track - b.track);
  const tempos: Tempo[] = [{ tick: 0, tempo: 500000, seconds: 0 }];
  for (const event of events) {
    const prev = tempos.at(-1)!;
    if (event.tick === prev.tick) {
      if (prev.track !== undefined && event.tempo !== prev.tempo) throw new Error('Conflicting MIDI tempos at the same tick');
      Object.assign(prev, event); continue;
    }
    tempos.push({ ...event, seconds: prev.seconds + (event.tick - prev.tick) * prev.tempo / ppq / 1e6 });
  }
  const secondsAt = (tick: number) => {
    let tempo = tempos[0];
    for (const next of tempos) { if (next.tick > tick) break; tempo = next; }
    return tempo.seconds + (tick - tempo.tick) * tempo.tempo / ppq / 1e6;
  };
  return { ppq, tempos, secondsAt, notes: noteEvents.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch || a.track - b.track) };
}

/** Three disjoint pitch banks on one channel. Durations are ticks, never guessed from BPM. */
export function convertMidi(buffer: Uint8Array, config: MidiConfig): Chart {
  const midi = readMidi(buffer);
  if (midi.tempos.some(event => 60e6 / event.tempo < 40 || 60e6 / event.tempo > 300)) throw new Error('Chart BPM must be between 40 and 300');
  if (!Number.isFinite(config.offsetSeconds) || config.offsetSeconds < 0 || config.offsetSeconds > 7200) throw new Error('Invalid video offset');
  if (!config.lanes || !midi.notes.length || midi.notes.length > 5000) throw new Error('Supply a lane map and 1–5000 notes');
  for (const pitch of [...new Set(midi.notes.map(note => note.pitch))]) {
    const lane = config.lanes[pitch];
    const special = BOX_PITCHES.includes(pitch) || SLIDE_PITCHES.includes(pitch) || pitch === DD_PITCH;
    if (special && lane !== undefined) throw new Error(`Reserved gimmick pitch cannot be in lane map: ${pitch}`);
    if (!special && (!Number.isInteger(lane) || lane < 0 || lane > 5)) throw new Error(`Unmapped MIDI pitch: ${pitch}`);
  }
  const round = (value: number) => Number(value.toFixed(9));
  const videoTime = (tick: number) => round(midi.secondsAt(tick) + config.offsetSeconds);
  const notes: ChartNote[] = [];
  for (const note of midi.notes) {
    if (BOX_PITCHES.includes(note.pitch) || SLIDE_PITCHES.includes(note.pitch)) continue;
    const base = {id:0, time:videoTime(note.tick), lane:config.lanes[note.pitch] ?? 2};
    if (note.pitch === DD_PITCH) notes.push({...base, type:'tap', gimmick:'dd'});
    else notes.push(note.endTick - note.tick >= 1.5 * midi.ppq ? {...base, type:'hold', endTime:videoTime(note.endTick)} : {...base, type:'tap'});
  }
  // Six tagged colours describe one box gesture, anchored at the first marker.
  const box = midi.notes.filter(note => BOX_PITCHES.includes(note.pitch));
  if (box.length % 6) throw new Error('箱オシは6音ずつ指定してください。');
  for (let i = 0; i < box.length; i += 6) {
    const group = box.slice(i, i + 6);
    if (new Set(group.map(note => note.pitch)).size !== 6) throw new Error('箱オシは6色を1回ずつ指定してください。');
    group.forEach(note => notes.push({id:0, time:videoTime(group[0].tick), lane:BOX_PITCHES.indexOf(note.pitch), type:'tap', gimmick:'box', boxId:i / 6 + 1}));
  }
  // Consecutive touching slide-bank notes describe one continuous gesture. A gap starts another.
  const slides = midi.notes.filter(note => SLIDE_PITCHES.includes(note.pitch));
  for (let i = 0; i < slides.length;) {
    const group = [slides[i++]];
    while (i < slides.length && slides[i].tick <= group.at(-1)!.endTick) {
      if (slides[i].tick !== group.at(-1)!.endTick) throw new Error('オシ変の音符は重ねず、終端と次の始端をぴったりつないでください。');
      group.push(slides[i++]);
    }
    if (group.length < 2 || group.length > 129) throw new Error('オシ変は2〜129音を隙間なくつないで指定してください。');
    const lanes = group.map(note => SLIDE_PITCHES.indexOf(note.pitch));
    if (lanes.some((lane, j) => j > 0 && lane === lanes[j - 1]) || group.some(note => videoTime(note.endTick) - videoTime(note.tick) < .03 - 1e-8)) throw new Error('オシ変は30ms以上の間隔で別の色へ移動してください。');
    notes.push({id:0, time:videoTime(group[0].tick), endTime:videoTime(group.at(-1)!.endTick), lane:lanes[0], type:'hold', gimmick:'slide', path:group.slice(1).map((note, j) => ({time:videoTime(note.tick), lane:lanes[j + 1]}))});
  }
  notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  notes.forEach((note, i) => { note.id = i + 1; });
  if (notes.some(note => (note.type === 'hold' ? note.endTime : note.time) > 7200)) throw new Error('Chart extends beyond 7200 seconds');
  // Reject conflicts on every occupied lane, including slide segments. DD stays independent.
  for (let lane = 0; lane < 6; lane++) {
    const spans = notes.flatMap(note => {
      if (note.gimmick === 'dd') return [];
      const points = [{time:note.time, lane:note.lane}, ...(note.path ?? [])];
      return points.flatMap((point, i) => point.lane === lane ? [{start:point.time, end:points[i + 1]?.time ?? (note.type === 'hold' ? note.endTime : note.time), id:note.id}] : []);
    }).sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i++) if (spans[i].start === spans[i - 1].start || spans[i].start < spans[i - 1].end - 1e-8) throw new Error(`Overlapping notes after lane mapping: lane ${lane + 1}, ${spans[i].start}s`);
  }
  const initial = midi.tempos[0];
  const tempoChanges = midi.tempos.slice(1).filter((tempo, i) => tempo.tempo !== midi.tempos[i].tempo)
    .map(tempo => ({ time: videoTime(tempo.tick), bpm: round(60e6 / tempo.tempo) }));
  return { videoId: config.videoId, title: config.title, bpm: round(60e6 / initial.tempo), startTime: notes[0].time,
    beatOrigin: config.offsetSeconds, ...(tempoChanges.length ? { tempoChanges } : {}), notes };
}
