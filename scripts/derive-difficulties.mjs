import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
const server=await createServer({configFile:false,server:{middlewareMode:true},optimizeDeps:{noDiscovery:true,entries:[]}});
try {
  const {easyChart,hardChart}=await server.ssrLoadModule('/scripts/lib/difficulty-authoring.ts');
  const {parseChart}=await server.ssrLoadModule('/src/chart-data.ts');
  const {playableNotes}=await server.ssrLoadModule('/src/note-display.ts');
  const {SONGS}=await server.ssrLoadModule('/src/songs.ts');
  for(const song of SONGS) {
    const json=readFileSync(`src/charts/${song.chartId}.json`,'utf8'),normal=parseChart(json,true,song);
    console.log(song.title,'source SHA256',createHash('sha256').update(json).digest('hex'));
    for(const [difficulty,derive] of [['easy',easyChart],['hard',hardChart]]) {
      const chart=parseChart(JSON.stringify(derive(normal)),true,song),notes=playableNotes(chart.notes);
      writeFileSync(`src/charts/${song.chartId}-${difficulty}.json`,JSON.stringify(chart,null,2)+'\n');
      console.log(difficulty,{notes:notes.length,holds:notes.filter(n=>n.type==='hold'&&n.gimmick!=='slide').length,dd:notes.filter(n=>n.gimmick==='dd').length,box:notes.filter(n=>n.gimmick==='box').length,slides:notes.filter(n=>n.gimmick==='slide').length});
    }
  }
} finally {await server.close();}
