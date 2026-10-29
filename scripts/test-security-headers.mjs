import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,chmodSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const directory=mkdtempSync(join(tmpdir(),'rhythm-headers-')),name='rhythm-headers-'+randomUUID().slice(0,8);
const env={...process.env,DOCKER_CONFIG:process.env.DOCKER_CONFIG||join(tmpdir(),'rhythm-docker')};
const docker=args=>execFileSync('docker',args,{env,encoding:'utf8',stdio:['pipe','pipe','pipe']});
try{
  // Only synthetic static files, never the application's PHP or private configuration.
  chmodSync(directory,0o755);mkdirSync(join(directory,'.vite'));writeFileSync(join(directory,'index.html'),'<h1>Header check</h1>');writeFileSync(join(directory,'.vite/manifest.json'),'old leftover manifest');
  writeFileSync(join(directory,'.htaccess'),readFileSync('dist/.htaccess'));
  chmodSync(join(directory,'.vite'),0o755);for(const file of ['index.html','.htaccess','.vite/manifest.json'])chmodSync(join(directory,file),0o644);
  docker(['create','--name',name,'-p','127.0.0.1:4196:80','httpd:2.4','sh','-c',"sed -i 's/^#LoadModule headers_module/LoadModule headers_module/;s/AllowOverride None/AllowOverride All/g' conf/httpd.conf && httpd -t && exec httpd-foreground"]);
  docker(['cp',directory,`${name}:/usr/local/apache2/htdocs/rhythm`]);docker(['start',name]);
  let response;
  for(let attempt=0;attempt<40;attempt++){try{response=await fetch('http://127.0.0.1:4196/rhythm/',{signal:AbortSignal.timeout(1000)});break;}catch{await new Promise(resolve=>setTimeout(resolve,200));}}
  assert.ok(response,'Apache did not start');assert.equal(response.status,200);assert.ok(response.headers.get('content-security-policy-report-only')?.includes("default-src 'self'"));assert.equal(response.headers.get('content-security-policy'),null);
  assert.equal((await fetch('http://127.0.0.1:4196/rhythm/.vite/manifest.json')).status,403);
  console.log('Apache 2.4: valid .htaccess, report-only policy and legacy manifest denial passed.');
}catch(error){try{process.stderr.write(docker(['logs',name]));process.stderr.write(docker(['exec',name,'ls','-la','/usr/local/apache2/htdocs/rhythm']));}catch{}throw error;}finally{try{docker(['rm','-f',name]);}catch{}rmSync(directory,{recursive:true,force:true});}
