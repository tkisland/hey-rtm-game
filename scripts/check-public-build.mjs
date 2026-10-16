import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Run on every public build, including the GitHub Pages deployment build.
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const output = files('dist');
for (const required of [join('dist', 'index.html'), join('dist', 'game.html')]) {
  if (!output.includes(required)) throw new Error(`Missing public page: ${required}`);
}
const privateMarkers = ['record-toggle', 'hey-rhythm-editor-v1', 'hey-rhythm-custom-chart-v1', 'id="open-editor"', 'id="chart-source"', 'id="bpm"', 'id="start-time"', 'id="debug-toggle"', '<!-- admin:start -->', '譜面エディター', '保存譜面で遊ぶ', 'テスト譜面で遊ぶ'];
for (const path of output) {
  if (/(?:editor|timeline)[^/]*\.(?:html|js|css)(?:\.map)?$/.test(path)) throw new Error(`Admin asset in public output: ${path}`);
  if (!/\.(?:html|js|css|json|map)$/.test(path)) continue;
  const content = readFileSync(path, 'utf8');
  for (const marker of privateMarkers) if (content.includes(marker)) throw new Error(`Admin functionality in ${path}: ${marker}`);
}
console.log('Public output verified: player pages only; no editor, draft storage or chart-editing controls.');
