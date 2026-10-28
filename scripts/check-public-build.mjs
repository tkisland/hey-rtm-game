import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function files(directory) {
  return readdirSync(directory, {withFileTypes:true}).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const output = files('dist'), pages = ['index.html','game.html','admin.html','rankings.html'];
for (const page of pages) if (!output.includes(join('dist', page))) throw new Error(`Missing public page: ${page}`);
if (output.includes(join('dist','editor.html'))) throw new Error('Admin asset in public output: standalone local editor');
const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json','utf8'));
const content = file => readFileSync(join('dist',file),'utf8');
function graph(entry, dynamic = false, result = new Set()) {
  if (result.has(entry)) return result;
  const chunk = manifest[entry]; if (!chunk) throw new Error(`Missing manifest entry: ${entry}`);
  result.add(entry);
  for (const dependency of [...(chunk.imports ?? []), ...(dynamic ? chunk.dynamicImports ?? [] : [])]) graph(dependency,dynamic,result);
  return result;
}
const privateMarkers = ['record-toggle','hey-rhythm-editor-v1','hey-rhythm-custom-chart-v1','id="open-editor"','id="chart-source"','id="bpm"','id="start-time"','id="debug-toggle"','<!-- admin:start -->','譜面エディター','保存譜面で遊ぶ','練習譜面で遊ぶ'];
privateMarkers.push('id="offset"','id="input-offset"','id="sound-toggle"','id="sound-delay"','id="auto-calibrate"','id="timing-reset"','id="sound-test"');
for (const page of pages) {
  const chunks = [...graph(page)].map(key => manifest[key].file);
  for (const file of [page,...chunks]) {
    const text = content(file);
    const markers = page === 'admin.html' ? ['record-toggle'] : privateMarkers;
    for (const marker of markers) if (text.includes(marker)) throw new Error(`Admin functionality in initial ${file}: ${marker}`);
  }
}
const referenced = new Set(pages);
for (const page of pages) for (const key of graph(page,true)) {
  referenced.add(manifest[key].file);
  for (const file of manifest[key].css ?? []) referenced.add(file);
}
for (const path of output) {
  if (/\.(?:html|js)$/.test(path) && readFileSync(path,'utf8').includes('demo-hey-rtm')) throw new Error('Emulator configuration must not be published.');
  const relative = path.slice('dist'.length+1).replaceAll('\\','/');
  if (/(?:^|\/)(?:config(?:\.example)?\.php|schema\.sql|\.env(?:\..*)?)$/.test(relative)) throw new Error(`Private server setup file in public output: ${relative}`);
  if (/\.(?:html|js|css)$/.test(path) && !referenced.has(relative)) throw new Error(`Admin asset in public output or unreferenced file: ${relative}`);
}
console.log('Public output verified: player pages contain no editing controls; online editor loads separately after administrator authentication.');
