import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {createServer,loadEnv} from 'vite';

// Reuse the actual parser/catalog so PHP sees exactly the JSON hashed by the game.
const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true,entries:[]}});
try {
  const {SONGS}=await server.ssrLoadModule('/src/songs.ts');
  const {DIFFICULTIES}=await server.ssrLoadModule('/src/difficulties.ts');
  const {bundledChart}=await server.ssrLoadModule('/src/bundled-charts.ts');
  const {parseCloudConfig}=await server.ssrLoadModule('/src/cloud-schema.ts');
  const {SCORE_RULES_VERSION}=await server.ssrLoadModule('/src/engine.ts');
  const env=loadEnv('production',process.cwd(),'');
  const config=parseCloudConfig(process.env.VITE_FIREBASE_CONFIG ?? env.VITE_FIREBASE_CONFIG);
  const songs=Object.fromEntries(SONGS.map(song=>[song.id,{videoId:song.videoId,charts:Object.fromEntries(DIFFICULTIES.flatMap(({id})=>{
    const chart=bundledChart(song,id);return chart?[[id,JSON.stringify(chart)]]:[];
  }))}]));
  await mkdir('dist/api',{recursive:true});
  for(const file of ['ranking.php','core.php'])await copyFile(`server/api/${file}`,`dist/api/${file}`);
  await writeFile('dist/api/catalog.json',JSON.stringify({schemaVersion:1,rulesVersion:SCORE_RULES_VERSION,firebase:config?{projectId:config.projectId,apiKey:config.apiKey}:null,songs}));
  console.log('Ranking PHP and authoritative chart catalog prepared; database credentials are not included.');
} finally {await server.close();}
