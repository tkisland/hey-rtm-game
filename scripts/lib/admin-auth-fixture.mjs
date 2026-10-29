import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {sign} from 'node:crypto';

/** TLS identity/role services exist only on the isolated Docker network, never in dist. */
export function prepareAdminAuth({docker,network,name,temporary}){
  const directory=join(temporary,'auth-fixture');mkdirSync(directory);
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',join(directory,'key.pem'),'-out',join(directory,'ca.pem'),'-subj','/CN=identitytoolkit.googleapis.com','-addext','subjectAltName=DNS:identitytoolkit.googleapis.com,DNS:firestore.googleapis.com'],{stdio:'pipe'});
  writeFileSync(join(directory,'state.json'),JSON.stringify({enabled:true,disabled:false,validSince:0}));
  writeFileSync(join(directory,'https.php'),readFileSync('tests/fixtures/admin-auth-https.php'));
  docker(['create','--name',name,'--network',network,'--network-alias','identitytoolkit.googleapis.com','--network-alias','firestore.googleapis.com','hey-rhythm-ranking-test','php','/private/https.php']);
  docker(['cp',directory,`${name}:/private`]);docker(['start',name]);
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url'),now=Math.floor(Date.now()/1000);
  const makeToken=(uid,changes={})=>{
    const input=encode({alg:'RS256',kid:'fixture',typ:'JWT'})+'.'+encode({iss:'https://securetoken.google.com/admin-test',aud:'admin-test',sub:uid,iat:now,auth_time:now-10,exp:now+3600,email_verified:true,firebase:{sign_in_provider:'google.com'},...changes});
    return input+'.'+sign('RSA-SHA256',Buffer.from(input),readFileSync(join(directory,'key.pem'))).toString('base64url');
  };
  return {admin:makeToken('owner'),viewer:makeToken('viewer'),unverified:makeToken('owner',{email_verified:false}),expired:makeToken('owner',{exp:now-1}),other:makeToken('owner',{aud:'other-project'}),password:makeToken('owner',{firebase:{sign_in_provider:'password'}}),state:changes=>docker(['exec',name,'php','-r',`file_put_contents('/private/state.json',base64_decode('${Buffer.from(JSON.stringify({enabled:true,disabled:false,validSince:0,...changes})).toString('base64')}'));`])};
}
