import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'vite';

// Isolated real MySQL/PHP. No production server, credentials or Firebase writes.
const suffix=randomUUID().slice(0,8),network=`rhythm-rank-${suffix}`,mysql=`rhythm-db-${suffix}`,php=`rhythm-php-${suffix}`;
const temporary=mkdtempSync(join(tmpdir(),'rhythm-ranking-'));
const env={...process.env,DOCKER_CONFIG:process.env.DOCKER_CONFIG || join(tmpdir(),'rhythm-docker')};
const docker=(args,options={})=>execFileSync('docker',args,{env,encoding:'utf8',stdio:['pipe','pipe','pipe'],...options});
const sql=text=>docker(['exec','-i','--env','MYSQL_PWD=rhythm_root_pass',mysql,'mysql','-uroot','rhythm'],{input:text});
const hash=text=>createHash('sha256').update(text).digest('hex');
const base='http://127.0.0.1:4194/rhythm/api/ranking.php';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let checks=0;
async function api(action,data={},expected=200,origin='http://127.0.0.1:4194'){
  const url=new URL(base);url.searchParams.set('action',action);
  const post=['start','submit'].includes(action);
  if(!post)for(const [key,value] of Object.entries(data))url.searchParams.set(key,value);
  const response=await fetch(url,{...(post?{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(data)}:{})});
  const body=await response.json();assert.equal(response.status,expected,JSON.stringify(body));checks++;return body;
}
try {
  docker(['build','-f','server/Dockerfile.test','-t','hey-rhythm-ranking-test','server'],{stdio:'inherit'});
  docker(['network','create',network]);
  docker(['run','-d','--name',mysql,'--network',network,'--network-alias','db','-e','MYSQL_ROOT_PASSWORD=rhythm_root_pass','-e','MYSQL_DATABASE=rhythm','-e','MYSQL_USER=rhythm','-e','MYSQL_PASSWORD=rhythm_test_pass','mysql:8.4']);
  let ready=false;
  for(let attempt=0;attempt<90;attempt++){
    try{sql('SELECT 1;');ready=true;break;}catch{await pause(1000);}
  }
  assert.ok(ready,'MySQL did not become ready');sql(readFileSync('server/setup/schema.sql','utf8'));
  writeFileSync(join(temporary,'config.php'),`<?php return ['db_host'=>'db','db_name'=>'rhythm','db_user'=>'rhythm','db_password'=>'rhythm_test_pass','allowed_origin'=>'http://127.0.0.1:4194'];`);
  docker(['create','--name',php,'--network',network,'-p','127.0.0.1:4194:8080','-e','RHYTHM_CONFIG_PATH=/private/config.php','hey-rhythm-ranking-test']);
  docker(['cp','dist',`${php}:/app/rhythm`]);docker(['cp',temporary,`${php}:/private`]);
  const catalog=JSON.parse(readFileSync('dist/api/catalog.json','utf8'));
  // The deployed catalog keeps its real public configuration; only this test copy
  // disables remote reads so CI never contacts a production Firebase project.
  catalog.firebase=null;
  const chart={videoId:'abcdefghijk',title:'Contract test',bpm:120,startTime:0,notes:[
    {id:1,type:'tap',lane:0,time:1},{id:2,type:'tap',lane:1,time:1},
    {id:3,type:'hold',lane:2,time:1.5,endTime:2.5},{id:4,type:'tap',lane:3,time:2},
    {id:5,type:'tap',lane:4,time:3,gimmick:'dd'},
    ...Array.from({length:6},(_,lane)=>({id:6+lane,type:'tap',lane,time:4+lane*.1,gimmick:'box',boxId:1})),
    {id:12,type:'hold',lane:5,time:6,endTime:8,gimmick:'slide',path:[{time:7,lane:0}]},
    {id:13,type:'tap',lane:2,time:8.1},
  ]};
  const fixture=JSON.stringify(chart);catalog.songs['ranking-test']={videoId:chart.videoId,charts:{normal:fixture,easy:fixture}};
  const putCatalog=()=>{writeFileSync(join(temporary,'catalog.json'),JSON.stringify(catalog));docker(['cp',join(temporary,'catalog.json'),`${php}:/app/rhythm/api/catalog.json`]);};
  putCatalog();docker(['start',php]);
  for(let attempt=0;attempt<30;attempt++){
    try{if((await (await fetch(`${base}?action=status`)).json()).enabled)break;}catch{}
    await pause(200);
  }
  assert.equal((await api('status')).enabled,true);
  for(const [method,type,body,origin,status] of [
    ['GET','application/json',undefined,'http://127.0.0.1:4194',405],
    ['POST','text/plain','{}','http://127.0.0.1:4194',415],
    ['POST','application/json','{','http://127.0.0.1:4194',400],
    ['POST','application/json','x'.repeat(350001),'http://127.0.0.1:4194',413],
    ['POST','application/json','{}','',403],
  ]){
    const response=await fetch(`${base}?action=start`,{method,headers:{'content-type':type,origin},...(body===undefined?{}:{body})});
    assert.equal(response.status,status);assert.equal((await response.json()).ok,false);checks++;
  }
  const fields={schemaVersion:{integerValue:'1'},songId:{stringValue:'ranking-test'},videoId:{stringValue:chart.videoId},revision:{integerValue:'1'},noteCount:{integerValue:String(chart.notes.length)},json:{stringValue:fixture}};
  const encoded=Buffer.from(JSON.stringify(fields)).toString('base64');
  const phpChecks=`<?php require '/app/rhythm/api/core.php'; $f=json_decode(base64_decode('${encoded}'),true); $h=hash('sha256',$f['json']['stringValue']);
    if(rh_publication($f,'ranking-test','abcdefghijk','normal',$h)===null)throw new Exception('normal rejected');
    if(rh_publication($f,'ranking-test','abcdefghijk','easy',$h)!==null)throw new Exception('cross level accepted');
    $f['schemaVersion']['integerValue']='2';$f['difficulty']['stringValue']='easy';
    if(rh_publication($f,'ranking-test','abcdefghijk','easy',$h)===null)throw new Exception('easy rejected');
    if(rh_publication($f,'ranking-test','abcdefghijk','hard',$h)!==null)throw new Exception('wrong level accepted');
    if(rh_publication($f,'other-song','abcdefghijk','easy',$h)!==null)throw new Exception('wrong song accepted');
    $f['noteCount']['integerValue']='1';if(rh_publication($f,'ranking-test','abcdefghijk','easy',$h)!==null)throw new Exception('wrong count accepted');
    file_put_contents('/app/private-test.php','<?php return '.var_export(['db_host'=>'db','db_name'=>'rhythm','db_user'=>'rhythm','db_password'=>'local_test'],true).';');$_SERVER['DOCUMENT_ROOT']='/app';putenv('RHYTHM_CONFIG_PATH=/app/private-test.php');
    if(rh_config()!==null)throw new Exception('public config accepted');unlink('/app/private-test.php');echo 'PHP publication/config checks passed.';`;
  console.log(docker(['exec','-i',php,'php'],{input:phpChecks}));
  const server=await createServer({configFile:false,server:{middlewareMode:true},optimizeDeps:{noDiscovery:true,entries:[]}});
  let perfect,miss;
  try {
    const {GameEngine}=await server.ssrLoadModule('/src/engine.ts');
    const play=fail=>{
      const game=new GameEngine(chart);
      if(!fail)game.input(0,1);game.input(1,1);if(fail)game.advance(1.17);
      game.input(2,1.5);game.input(3,2);game.release(2,2.5);game.input(4,3);
      for(const lane of [2,3,1,4,0,5])game.input(lane,4);
      game.input(5,6);game.advance(7,new Set([0]));game.release(0,8);game.input(2,8.1);
      assert.equal(game.finished,true);
      return {score:game.score,maxCombo:game.maxCombo,results:game.rankingJudgements()};
    };
    perfect=play(false);miss=play(true);assert.equal(perfect.score,8000);assert.equal(miss.score,6000);
  } finally {await server.close();}
  const board={songId:'ranking-test',difficulty:'normal',chartHash:hash(fixture),rulesVersion:1};
  const start=async(target=board)=>{
    const {token}=await api('start',target);
    sql(`UPDATE rhythm_sessions SET issued_at=issued_at-30 WHERE token_hash='${hash(token)}';`);return token;
  };
  await api('start',{...board,songId:'unknown'},400);await api('start',{...board,difficulty:'expert'},400);
  await api('start',{...board,rulesVersion:999},400);
  await api('start',{...board,chartHash:'0'.repeat(64)},409);
  await api('start',board,403,'https://other.example');
  const early=(await api('start',board)).token;
  await api('submit',{token:early,name:'ABCDE',...perfect},422);
  const token=await start();
  for(const name of ['AB','ABCDEFG','あいうえお','AB<DE',"A'BCD"] )await api('submit',{token,name,...perfect},422);
  await api('submit',{token,name:'ABCDE',...perfect,score:9000},422);
  await api('submit',{token,name:'ABCDE',...perfect,results:perfect.results.slice(1)},422);
  await api('submit',{token,name:'ABCDE',...perfect,results:perfect.results.map((item,i)=>i===1?perfect.results[0]:item)},422);
  await api('submit',{token,name:'ABCDE',...perfect,results:perfect.results.map(()=>null)},422);
  const first=await api('submit',{token,name:'abc12',...perfect});assert.equal(first.entry.name,'ABC12');assert.equal(first.rank,1);
  assert.equal((await api('submit',{token,name:'ABC12',...perfect})).entry.id,first.entry.id);
  await api('submit',{token,name:'OTHER',...perfect},409);
  const second=await api('submit',{token:await start(),name:'ABC12',...perfect});assert.equal(second.rank,2);
  assert.equal((await api('submit',{token:await start(),name:'LOWER',...miss})).rank,3);
  const list=await api('leaderboard',board);assert.deepEqual(list.entries.map(item=>[item.name,item.score]),[['ABC12',8000],['ABC12',8000],['LOWER',6000]]);
  const easy={...board,difficulty:'easy'};await start(easy);assert.deepEqual((await api('leaderboard',easy)).entries,[]);
  assert.equal((await api('submit',{token:await start(easy),name:'ab3',...perfect})).entry.name,'AB3');
  assert.equal((await api('submit',{token:await start(easy),name:'ABCD',...perfect})).entry.name,'ABCD');
  const updated=JSON.stringify({...chart,title:'New chart release'});catalog.songs['ranking-test'].charts.normal=updated;putCatalog();
  const nextBoard={...board,chartHash:hash(updated)};await start(nextBoard);assert.deepEqual((await api('leaderboard',nextBoard)).entries,[]);
  assert.equal((await api('leaderboard',board)).entries.length,3);
  const expired=await start();sql(`UPDATE rhythm_sessions SET expires_at=1 WHERE token_hash='${hash(expired)}';`);
  await api('submit',{token:expired,name:'ABCDE',...perfect},410);
  sql('TRUNCATE TABLE rhythm_rate_limits;');
  for(let i=0;i<30;i++)await api('start',board);
  await api('start',board,429);
  docker(['exec',php,'php','-r',"rename('/private/config.php','/private/config.disabled');"]);
  assert.equal((await api('status')).enabled,false);await api('start',board,503);
  docker(['exec',php,'php','-r',"rename('/private/config.disabled','/private/config.php');"]);
  docker(['exec',php,'php','-r',"rename('/app/rhythm/api/catalog.json','/app/rhythm/api/catalog.disabled');"]);
  assert.equal((await api('status')).enabled,false);await api('start',board,503);
  docker(['exec',php,'php','-r',"rename('/app/rhythm/api/catalog.disabled','/app/rhythm/api/catalog.json');"]);
  console.log(`Ranking API: ${checks} HTTP checks passed against PHP 8.3 / MySQL 8.4.`);
  // Fast-forwarding the browser clock must not bypass the API's real elapsed-time
  // check in production. Only these isolated test DB rows are shortened.
  sql('TRUNCATE TABLE rhythm_rate_limits;TRUNCATE TABLE rhythm_sessions;TRUNCATE TABLE rhythm_entries;');
  for(const song of ['super-mommy-girls','biscuit-case'])await api('start',{songId:song,difficulty:'normal',chartHash:hash(catalog.songs[song].charts.normal),rulesVersion:1});
  sql('UPDATE rhythm_boards SET minimum_seconds=0;TRUNCATE TABLE rhythm_rate_limits;TRUNCATE TABLE rhythm_sessions;');
  execFileSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config','playwright.ranking.config.ts'],{stdio:'inherit',env:{...env,RANKING_DB_CONTAINER:mysql}});
} finally {
  for(const name of [php,mysql])try{docker(['rm','-f',name]);}catch{}
  try{docker(['network','rm',network]);}catch{}
  rmSync(temporary,{recursive:true,force:true});
}
