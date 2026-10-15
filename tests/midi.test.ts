import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { readMidi, convertMidi } from '../scripts/midi-to-chart.mjs';
import { GameEngine } from '../src/engine';
import { parseChart } from '../src/editor-model';
import smg from '../src/charts/smg001.json';

const input = readFileSync(new URL('../charts/source/game-SMG001.mid', import.meta.url));
const config = JSON.parse(readFileSync(new URL('../charts/source/game-SMG001.config.json', import.meta.url), 'utf8'));
function vlq(value: number): number[] {
  const bytes = [value & 127]; while ((value >>= 7)) bytes.unshift((value & 127) | 128); return bytes;
}
function midi(tracks: number[][], ppq = 480): Buffer {
  const header = Buffer.alloc(14); header.write('MThd'); header.writeUInt32BE(6, 4); header.writeUInt16BE(tracks.length === 1 ? 0 : 1, 8); header.writeUInt16BE(tracks.length, 10); header.writeUInt16BE(ppq, 12);
  return Buffer.concat([header, ...tracks.map(data => { const h = Buffer.alloc(8); h.write('MTrk'); h.writeUInt32BE(data.length, 4); return Buffer.concat([h, Buffer.from(data)]); })]);
}
const end = [0, 0xff, 0x2f, 0];
it('reproduces all 509 uploaded notes with the confirmed lanes and the 7.65s origin', () => {
  const chart = convertMidi(input, config);
  expect(chart).toEqual(smg);
  expect(chart.notes).toHaveLength(509); expect(chart.notes.filter((n: any) => n.type === 'hold')).toHaveLength(22);
  expect(chart.notes[0]).toMatchObject({ time: 7.65, lane: 5, type: 'tap' });
  expect(chart.notes[1].time).toBeCloseTo(8.011445, 8);
  expect(chart.tempoChanges).toEqual([{ time: 18.626632844, bpm: 192 }]);
  expect(Math.max(...chart.notes.map((n: any) => n.endTime ?? n.time))).toBeCloseTo(214.640955760, 8);
  expect(readMidi(input).notes.filter((n: any) => n.pitch === 39)).toHaveLength(6);
  for (const time of [92.886398469, 93.198898469, 93.511398469, 97.886398469, 98.198898469, 98.511398469]) expect(chart.notes.find((n: any) => Math.abs(n.time - time) < 1e-8)?.lane).toBe(0);
  const groups = new Map<number, number>();
  for (const note of chart.notes) groups.set(note.time, (groups.get(note.time) ?? 0) + 1);
  expect([...groups.values()].filter(count => count === 2)).toHaveLength(32);
});
it('uses an inclusive 1.5-beat tick threshold and integrates tempos through a hold', () => {
  const data = midi([[0, 0xff, 0x51, 3, 7, 0xa1, 0x20, 0, 0x90, 38, 100, 0, 40, 100,
    ...vlq(480), 0xff, 0x51, 3, 3, 0xd0, 0x90,
    ...vlq(239), 0x80, 40, 0, 1, 38, 0, ...end]]);
  const chart = convertMidi(data, config);
  expect(chart.notes[0]).toEqual({ id: 1, lane: 0, time: 7.65, type: 'hold', endTime: 8.275 });
  expect(chart.notes[1]).toEqual({ id: 2, lane: 1, time: 7.65, type: 'tap' });
  expect(chart.tempoChanges).toEqual([{ time: 8.15, bpm: 240 }]);
});
it('reads shared conductor tempos, running status and velocity-zero note-offs', () => {
  const data = midi([[0, 0xff, 0x51, 3, 7, 0xa1, 0x20, ...end], [0, 0x90, 38, 100, ...vlq(960), 38, 0, ...end]]);
  expect(convertMidi(data, config).notes[0]).toMatchObject({ type: 'hold', time: 7.65, endTime: 8.65 });
});
it('refuses unmapped pitches, truncated data, missing note-offs and SMPTE timing', () => {
  expect(() => convertMidi(input, { ...config, lanes: {} })).toThrow('Unmapped MIDI pitch');
  expect(() => readMidi(input.subarray(0, input.length - 2))).toThrow('Truncated');
  expect(() => readMidi(midi([[0, 0x90, 38, 100, ...end]]))).toThrow('Missing note-off');
  expect(() => readMidi(midi([[...end]], 0xe728))).toThrow('SMPTE');
  expect(() => readMidi(midi([[0, 38, 100, ...end]]))).toThrow('running status');
  expect(() => readMidi(midi([[0, 0x80, 38, 0, ...end]]))).toThrow('Unmatched');
});
it('does not silently merge notes made unplayable by a lane map', () => {
  const data = midi([[0, 0x90, 38, 100, 0, 39, 100, ...vlq(480), 0x80, 38, 0, 0, 39, 0, ...end]]);
  expect(() => convertMidi(data, config)).toThrow('Overlapping');
});
it('the shipped chart can be played through with all 22 holds and 32 chords scoring once', () => {
  const chart = parseChart(JSON.stringify(smg), true), engine = new GameEngine(chart), pressed = new Set<number>();
  const times = [...new Set(chart.notes.flatMap(note => note.type === 'hold' ? [note.time, note.endTime] : [note.time]))].sort((a, b) => a - b);
  for (const time of times) {
    engine.advance(time, pressed);
    for (const note of chart.notes) if (note.type === 'hold' && note.endTime === time) pressed.delete(note.lane);
    for (const note of chart.notes.filter(note => note.time === time)) {
      expect(engine.input(note.lane, time)?.judgement).toBe('PERFECT');
      if (note.type === 'hold') pressed.add(note.lane);
    }
  }
  expect(engine.finished).toBe(true); expect(engine.counts).toEqual({ PERFECT: 509, GREAT: 0, GOOD: 0, MISS: 0 });
  expect(engine.score).toBe(509000); expect(engine.combo).toBe(509);
});
