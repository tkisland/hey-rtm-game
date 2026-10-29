import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

export async function testModeration({api,docker,sql,start,perfect,board,php,catalog,putCatalog,auth}){
  const base='http://127.0.0.1:4194/rhythm/';
  const original=catalog.firebase;catalog.firebase={projectId:'admin-test',apiKey:'fixture-key'};putCatalog();
  const mod=async(data,token=auth.admin,status=200,origin='http://127.0.0.1:4194')=>{
    const response=await fetch(base+'api/moderation.php',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({...data,...(token?{idToken:token}:{})})});const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;
  };
  const call={action:'list',songId:'ranking-test',difficulty:'hard'};
  try{
    await mod(call,null,401);await mod(call,auth.admin,403,'https://other.example');
    await mod(call,auth.viewer,403);await mod(call,auth.unverified,401);await mod(call,auth.expired,401);await mod(call,auth.other,401);await mod(call,auth.password,401);
    const parts=auth.admin.split('.');parts[2]=Buffer.from('forged signature').toString('base64url');await mod(call,parts.join('.'),401);
    auth.state({enabled:false});await mod(call,auth.admin,403);auth.state({disabled:true});await mod(call,auth.admin,401);auth.state({validSince:Math.floor(Date.now()/1000)+10});await mod(call,auth.admin,401);auth.state({});
    const token=await start(board),saved=await api('submit',{token,name:'MODME',...perfect}),shared=await api('share',{token,...perfect});
    let records=(await mod(call)).entries;const record=records.find(e=>e.id===saved.entry.id);assert.ok(record);assert.equal(record.hidden,false);assert.equal(record.revision,0);
    await mod({action:'hide',entryId:record.id,revision:0,reason:''},auth.admin,422);
    const hide={action:'hide',entryId:record.id,revision:0,reason:'確認のため非表示'};
    const hidden=await mod(hide);assert.equal(hidden.revision,1);assert.equal(hidden.hidden,true);
    assert.equal((await mod(hide)).revision,1,'retry does not duplicate the audit event');
    assert.ok(!(await api('leaderboard',board)).entries.some(e=>e.id===record.id));
    for(const page of ['share.php','share-image.php'])assert.equal((await fetch(`${base}${page}?id=${shared.id}`)).status,404,'cached images also honor moderation');
    await api('submit',{token,name:'MODME',...perfect},409);await api('share',{token,...perfect},409);
    await mod({action:'restore',entryId:record.id,revision:0,reason:'stale restore'},auth.admin,409);
    const another=await api('submit',{token:await start(board),name:'NEXT',...perfect});
    const publicRows=(await api('leaderboard',board)).entries;assert.equal(publicRows.findIndex(e=>e.id===another.entry.id)+1,another.rank,'rank excludes hidden entries');
    const restored=await mod({action:'restore',entryId:record.id,revision:1,reason:'確認済みのため復元'});assert.equal(restored.revision,2);
    const history=await mod({action:'history',entryId:record.id});assert.deepEqual(history.history.map(e=>[e.hidden,e.actorUid]),[[false,'owner'],[true,'owner']]);
    assert.ok((await api('leaderboard',board)).entries.some(e=>e.id===record.id));assert.equal((await fetch(`${base}share-image.php?id=${shared.id}`)).status,200);
    sql(readFileSync('server/setup/003-ranking-moderation.sql','utf8'));assert.equal((await mod({action:'history',entryId:record.id})).history.length,2);
    // Missing additive migration disables management without breaking existing leaderboards.
    sql('RENAME TABLE rhythm_entry_visibility TO rhythm_entry_visibility_disabled;');
    try{await mod(call,auth.admin,503);assert.ok((await api('leaderboard',board)).entries.length>0);}finally{sql('RENAME TABLE rhythm_entry_visibility_disabled TO rhythm_entry_visibility;');}
    const phpChecks=`<?php require '/app/rhythm/api/core.php';
      $_SERVER['REMOTE_ADDR']='203.0.113.10';$_SERVER['HTTP_X_FORWARDED_FOR']='192.0.2.99';
      if(rh_client_ip([])!=='203.0.113.10')throw new Exception('untrusted forwarded header');
      $c=['trusted_proxies'=>['203.0.113.0/24']];$_SERVER['HTTP_X_FORWARDED_FOR']='8.8.8.8, 198.51.100.4, 203.0.113.11';
      if(rh_client_ip($c)!=='198.51.100.4')throw new Exception('wrong proxy chain');
      $_SERVER['HTTP_X_FORWARDED_FOR']='invalid';if(rh_client_ip($c)!=='203.0.113.10')throw new Exception('invalid forwarded header');
      if(!rh_ip_in_range('2001:db8::2','2001:db8::/32')||rh_ip_in_range('2001:db9::2','2001:db8::/32'))throw new Exception('IPv6 range');
      $key=rh_rate_key(['db_password'=>'one']);if($key!==rh_rate_key(['db_password'=>'two'])||strlen($key)!==32)throw new Exception('key coupled to DB password');
      if((fileperms('/private/rate-limit.key')&0777)!==0600)throw new Exception('key permissions');
      $db=rh_db(rh_config());$cfg=rh_config();$_SERVER['REMOTE_ADDR']='198.51.100.100';unset($_SERVER['HTTP_X_FORWARDED_FOR']);
      for($i=0;$i<180;$i++)rh_rate_limit($db,$cfg,'default-start',180);
      try{rh_rate_limit($db,$cfg,'default-start',180);throw new Exception('limit failed');}catch(RankingError $e){if($e->httpStatus!==429)throw $e;}
      rh_rate_limit($db,$cfg,'admin-scope',1);
      echo 'Proxy trust, dedicated private key and independent configurable limits passed.';`;
    console.log(docker(['exec','-i',php,'php'],{input:phpChecks}));
    console.log('Moderation: real TLS identity/role checks, forged/revoked/disabled/non-admin denials, audit/conflict/idempotency, rank/share suppression and restore passed.');
  }finally{catalog.firebase=original;putCatalog();auth.state({});sql('TRUNCATE TABLE rhythm_rate_limits;');}
}
