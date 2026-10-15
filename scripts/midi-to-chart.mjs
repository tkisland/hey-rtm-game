import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Decode SMF 0/1 without guessing note names, lanes, tempo, or missing note-offs. */
export function readMidi(buffer) {
  let offset = 0;
  const need = (count, end = buffer.length) => { if (offset + count > end) throw new Error('Truncated MIDI data'); };
  const byte = end => { need(1, end); return buffer[offset++]; };
  const u16 = () => { need(2); const n = buffer.readUInt16BE(offset); offset += 2; return n; };
  const u32 = () => { need(4); const n = buffer.readUInt32BE(offset); offset += 4; return n; };
  const tag = () => { need(4); const s = buffer.toString('ascii', offset, offset + 4); offset += 4; return s; };
  const vlq = end => {
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
  const events = [], noteEvents = [];
  for (let track = 0; track < trackCount; track++) {
    if (tag() !== 'MTrk') throw new Error('Missing MIDI track');
    const length = u32(), end = offset + length;
    need(length);
    let tick = 0, running = 0, ended = false;
    const active = new Map();
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
          const tempo = buffer.readUIntBE(offset, 3);
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
        const start = queue.shift();
        if (tick <= start) throw new Error('MIDI notes must have positive length');
        noteEvents.push({ tick: start, endTick: tick, pitch: a, channel, track });
      }
    }
    if (!ended) throw new Error('Missing end-of-track');
    if ([...active.values()].some(queue => queue.length)) throw new Error(`Missing note-off in track ${track}`);
  }
  if (offset !== buffer.length) throw new Error('Unexpected data after MIDI tracks');
  events.sort((a, b) => a.tick - b.tick || a.track - b.track);
  const tempos = [{ tick: 0, tempo: 500000, seconds: 0 }];
  for (const event of events) {
    const prev = tempos.at(-1);
    if (event.tick === prev.tick) {
      if (prev.track !== undefined && event.tempo !== prev.tempo) throw new Error('Conflicting MIDI tempos at the same tick');
      Object.assign(prev, event); continue;
    }
    tempos.push({ ...event, seconds: prev.seconds + (event.tick - prev.tick) * prev.tempo / ppq / 1e6 });
  }
  const secondsAt = tick => {
    let tempo = tempos[0];
    for (const next of tempos) { if (next.tick > tick) break; tempo = next; }
    return tempo.seconds + (tick - tempo.tick) * tempo.tempo / ppq / 1e6;
  };
  return { ppq, tempos, secondsAt, notes: noteEvents.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch || a.track - b.track) };
}

export function convertMidi(buffer, config) {
  const midi = readMidi(buffer);
  if (midi.tempos.some(event => 60e6 / event.tempo < 40 || 60e6 / event.tempo > 300)) throw new Error('Chart BPM must be between 40 and 300');
  if (!Number.isFinite(config.offsetSeconds) || config.offsetSeconds < 0 || config.offsetSeconds > 7200) throw new Error('Invalid video offset');
  if (!config.lanes || !midi.notes.length || midi.notes.length > 5000) throw new Error('Supply a lane map and 1–5000 notes');
  const pitches = [...new Set(midi.notes.map(note => note.pitch))];
  for (const pitch of pitches) {
    const lane = config.lanes[pitch];
    if (!Number.isInteger(lane) || lane < 0 || lane > 5) throw new Error(`Unmapped MIDI pitch: ${pitch}`);
  }
  const round = value => Number(value.toFixed(9));
  const videoTime = tick => round(midi.secondsAt(tick) + config.offsetSeconds);
  const notes = midi.notes.map((note, i) => {
    const base = { id: i + 1, time: videoTime(note.tick), lane: config.lanes[note.pitch] };
    // 1.5 quarter-note beats in ticks, independent of elapsed seconds/tempo changes.
    return note.endTick - note.tick >= 1.5 * midi.ppq ? { ...base, type: 'hold', endTime: videoTime(note.endTick) } : { ...base, type: 'tap' };
  }).sort((a, b) => a.time - b.time || a.lane - b.lane || a.id - b.id);
  notes.forEach((note, i) => { note.id = i + 1; });
  if (notes.some(note => (note.endTime ?? note.time) > 7200)) throw new Error('Chart extends beyond 7200 seconds');
  for (let lane = 0; lane < 6; lane++) {
    let previous;
    for (const note of notes.filter(note => note.lane === lane)) {
      if (previous && (note.time === previous.time || note.time < (previous.endTime ?? previous.time) - 1e-8)) throw new Error(`Overlapping notes after lane mapping: lane ${lane + 1}, ${note.time}s`);
      previous = note;
    }
  }
  const initial = midi.tempos[0];
  const tempoChanges = midi.tempos.slice(1).filter((tempo, i) => tempo.tempo !== midi.tempos[i].tempo)
    .map(tempo => ({ time: videoTime(tempo.tick), bpm: round(60e6 / tempo.tempo) }));
  return { videoId: config.videoId, title: config.title, bpm: round(60e6 / initial.tempo), startTime: notes[0].time,
    beatOrigin: config.offsetSeconds, ...(tempoChanges.length ? { tempoChanges } : {}), notes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, configPath, output] = process.argv.slice(2);
  if (!input || !configPath || !output) throw new Error('Usage: node scripts/midi-to-chart.mjs input.mid config.json output.json');
  const chart = convertMidi(readFileSync(input), JSON.parse(readFileSync(configPath, 'utf8')));
  writeFileSync(output, JSON.stringify(chart, null, 2) + '\n');
  console.log(`${chart.notes.length} notes (${chart.notes.filter(note => note.type === 'hold').length} holds), start ${chart.startTime}s`);
}
