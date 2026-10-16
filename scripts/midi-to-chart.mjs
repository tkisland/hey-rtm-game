import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { convertMidi } from '../src/midi.ts';
export { convertMidi, readMidi } from '../src/midi.ts';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, configPath, output] = process.argv.slice(2);
  if (!input || !configPath || !output) throw new Error('Usage: node scripts/midi-to-chart.mjs input.mid config.json output.json');
  const chart = convertMidi(readFileSync(input), JSON.parse(readFileSync(configPath, 'utf8')));
  writeFileSync(output, JSON.stringify(chart, null, 2) + '\n');
  console.log(`${chart.notes.length} notes (${chart.notes.filter(note => note.type === 'hold').length} holds), start ${chart.startTime}s`);
}
