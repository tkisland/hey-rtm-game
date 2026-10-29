import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync,readFileSync} from 'node:fs';
const hash=value=>createHash('sha256').update(value).digest('hex');

/** Actual PHP/GD/MySQL contract: immutable anonymous results and bounded image generation. */
export async function testSharedResults({api,docker,sql,start,perfect,miss,board,php}) {
  const base='http://127.0.0.1:4194/rhythm/';
  const query=statement=>sql(statement).trim().split('\n').at(-1);
  const phpRun=source=>docker(['exec','-i',php,'php'],{input:`<?php ${source}`});
  const budget=()=>JSON.parse(phpRun("echo file_get_contents('/private/share-cache/.generation.json');"));
  const early=(await api('start',board)).token;
  await api('share',{token:early,...perfect},422);
  await api('share',{token:'0'.repeat(64),...perfect},410);
  const token=await start(board),before=query('SELECT COUNT(*) FROM rhythm_entries');
  await api('share',{token,...perfect,score:2147483647},422);
  await api('share',{token,...perfect},403,'https://other.example');
  const shared=await api('share',{token,...perfect});assert.match(shared.id,/^[a-f0-9]{32}$/);
  assert.equal(query('SELECT COUNT(*) FROM rhythm_entries'),before,'sharing does not register a name');
  assert.equal((await api('share',{token,...perfect})).id,shared.id);
  assert.equal((await api('share',{token,...perfect,results:[...perfect.results].reverse()})).id,shared.id);
  await api('share',{token,...miss},409);await api('submit',{token,name:'CHANGE',...miss},409);
  const submitted=await api('submit',{token,name:'SHARE',...perfect});assert.equal(submitted.entry.score,perfect.score);
  sql(readFileSync('server/setup/002-share-results.sql','utf8'));
  assert.equal(query(`SELECT COUNT(*) FROM rhythm_entries WHERE id=${submitted.entry.id}`),'1','migration preserves existing rankings');
  assert.equal((await api('share',{token,...perfect})).id,shared.id);
  const page=await fetch(`${base}share.php?id=${shared.id}&score=2147483647&combo=5000`);assert.equal(page.status,200);
  const html=await page.text();assert.ok(html.includes('1,003,300'));assert.ok(!html.includes('2,147,483,647'));assert.ok(!html.includes(token));
  const imageUrl=`${base}share-image.php?id=${shared.id}&art=4`;
  const generated=budget().used;
  const image=await fetch(imageUrl),png=Buffer.from(await image.arrayBuffer());assert.equal(image.status,200);assert.ok(image.headers.get('cache-control').includes('must-revalidate'));
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),630);
  writeFileSync('/tmp/rhythm-verified-share-preview.png',png);
  const head=await fetch(imageUrl,{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),png.length);assert.equal((await head.arrayBuffer()).byteLength,0);
  const cached=await fetch(imageUrl,{headers:{'If-None-Match':image.headers.get('etag')}});assert.equal(cached.status,304);assert.equal((await cached.arrayBuffer()).byteLength,0);
  assert.equal(budget().used,generated,'cached/HEAD/304 requests do not re-render');
  for(const path of ['share.php','share-image.php']){
    assert.equal((await fetch(`${base}${path}?id=${'f'.repeat(32)}`)).status,404);
    assert.equal((await fetch(`${base}${path}?id=../bad`)).status,400);
  }
  assert.equal(budget().used,generated,'unknown IDs cannot trigger GD');
  assert.equal(phpRun("echo is_dir('/app/rhythm/share-cache')?'public':'private';"),'private');
  // A single global budget applies even to valid, distinct IDs; cached images still work.
  const newer=await start(board);
  if(new Date().getUTCSeconds()>=58)await new Promise(resolve=>setTimeout(resolve,2200));
  phpRun("file_put_contents('/private/share-cache/.generation.json',json_encode(['bucket'=>(int)floor(time()/60),'used'=>30]));");
  await api('share',{token:newer,...perfect},429);
  assert.equal((await fetch(imageUrl)).status,200);
  const stored=query(`SELECT id FROM rhythm_shared_results WHERE token_hash='${hash(newer)}'`);
  phpRun("unlink('/private/share-cache/.generation.json');");
  assert.equal((await api('share',{token:newer,...perfect})).id,stored,'retry preserves its original ID');
  for(let i=0;i<3;i++)await api('share',{token:await start(board),...perfect});
  const size=Number(phpRun("echo array_sum(array_map('filesize',glob('/private/share-cache/*.png')));"));assert.ok(size<=2097152,'eviction enforces the configured capacity');
  phpRun("foreach(glob('/private/share-cache/*.png') as $p)touch($p,time()-31*86400);");
  await api('share',{token:await start(board),...perfect});
  assert.equal(Number(phpRun("echo count(glob('/private/share-cache/*.png'));")),1,'expired files are removed on a cache miss');
  // Cache deletion is recoverable; the durable result ID does not change.
  assert.equal((await fetch(imageUrl)).status,200);assert.equal(query(`SELECT COUNT(*) FROM rhythm_shared_results WHERE id='${shared.id}'`),'1');
  sql('RENAME TABLE rhythm_shared_results TO rhythm_shared_results_disabled;');
  try{
    const old=await start(board);await api('share',{token:old,...perfect},503);
    assert.equal((await api('submit',{token:old,name:'BEFORE',...perfect})).entry.score,perfect.score);
  }finally{sql('RENAME TABLE rhythm_shared_results_disabled TO rhythm_shared_results;');}
  // Clean only cache state in the isolated service, never production files.
  phpRun("foreach(glob('/private/share-cache/*.png') as $p)unlink($p);unlink('/private/share-cache/.generation.json');");
  console.log('Verified sharing: anonymous IDs, tamper/binding checks, additive migration, cache reuse/304/budget/eviction/expiry and recovery passed.');
}
