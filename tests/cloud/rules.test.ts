import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, setLogLevel, updateDoc } from 'firebase/firestore';

let env:RulesTestEnvironment;
setLogLevel('silent');
const claims = {email:'admin@example.test',email_verified:true,firebase:{sign_in_provider:'google.com' as const}};
const google = (uid='owner') => env.authenticatedContext(uid,claims).firestore();
const draft = (uid='owner',revision=1) => ({schemaVersion:1,songId:'song',videoId:'pJDfWpZ7CI4',json:'{"notes":[1]}',noteCount:1,revision,updatedAt:serverTimestamp(),updatedBy:uid});
beforeAll(async () => { env = await initializeTestEnvironment({projectId:'demo-hey-rtm',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync('firestore.rules','utf8')}}); });
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(),'admins','owner'),{enabled:true}); });
});
it('denies anonymous draft access, editing, publication and administrator lookup', async () => {
  const db=env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db,'draftCharts','song')));
  await assertFails(getDoc(doc(db,'admins','owner')));
  await assertFails(setDoc(doc(db,'draftCharts','song'),draft()));
  await assertFails(setDoc(doc(db,'publishedCharts','song'),{...draft(),draftRevision:1}));
});
it('denies a signed-in Google user without an enabled role and forbids self-promotion', async () => {
  const db=google('viewer');
  await assertSucceeds(getDoc(doc(db,'admins','viewer')));
  await assertFails(setDoc(doc(db,'admins','viewer'),{enabled:true}));
  await assertFails(updateDoc(doc(db,'admins','owner'),{enabled:true}));
  await assertFails(getDoc(doc(db,'draftCharts','song')));
  await assertFails(setDoc(doc(db,'draftCharts','song'),draft('viewer')));
});
it('requires verified Google sign-in even for a registered administrator', async () => {
  for (const token of [{...claims,email_verified:false},{...claims,firebase:{sign_in_provider:'password'}}]) {
    const db=env.authenticatedContext('owner',token).firestore();
    await assertFails(getDoc(doc(db,'draftCharts','song')));
    await assertFails(setDoc(doc(db,'draftCharts','song'),draft()));
  }
});
it('lets the administrator save drafts with exact revision increments and its own identity', async () => {
  const db=google(),ref=doc(db,'draftCharts','song');
  await assertSucceeds(getDoc(doc(db,'admins','owner')));
  await assertFails(getDoc(doc(db,'admins','someone-else')));
  await assertSucceeds(setDoc(ref,draft()));
  await assertSucceeds(setDoc(ref,draft('owner',2)));
  await assertFails(setDoc(ref,draft('owner',2)));
  await assertFails(setDoc(ref,draft('someone-else',3)));
  await assertFails(setDoc(ref,{...draft('owner',3),extra:'unsupported'}));
  await assertFails(setDoc(ref,{...draft('owner',3),noteCount:5001}));
});
it('publishes only an existing saved draft with a nonempty note count', async () => {
  const db=google(),ref=doc(db,'publishedCharts','song');
  await assertFails(setDoc(ref,{...draft(),draftRevision:1}));
  await setDoc(doc(db,'draftCharts','song'),draft());
  await assertFails(setDoc(ref,{...draft(),draftRevision:2}));
  await assertFails(setDoc(ref,{...draft(),draftRevision:1,json:'different'}));
  await assertFails(setDoc(ref,{...draft(),draftRevision:1,noteCount:0}));
  await assertSucceeds(setDoc(ref,{...draft(),draftRevision:1}));
  await assertFails(setDoc(ref,{...draft(),draftRevision:1}));
  await assertSucceeds(setDoc(ref,{...draft('owner',2),draftRevision:1}));
});
it('exposes only published documents to players and denies collection listing', async () => {
  const db=google(); await setDoc(doc(db,'draftCharts','song'),draft());
  await setDoc(doc(db,'publishedCharts','song'),{...draft(),draftRevision:1});
  const publicDb=env.unauthenticatedContext().firestore();
  expect((await assertSucceeds(getDoc(doc(publicDb,'publishedCharts','song')))).data()?.revision).toBe(1);
  await assertFails(getDocs(collection(publicDb,'publishedCharts')));
  await assertFails(getDoc(doc(publicDb,'draftCharts','song')));
});
it('rejects stale publications and immediately denies a revoked administrator', async () => {
  const db=google(); await setDoc(doc(db,'draftCharts','song'),draft());
  await setDoc(doc(db,'draftCharts','song'),draft('owner',2));
  await assertFails(setDoc(doc(db,'publishedCharts','song'),{...draft(),draftRevision:1}));
  await env.withSecurityRulesDisabled(async context => { await updateDoc(doc(context.firestore(),'admins','owner'),{enabled:false}); });
  await assertFails(getDoc(doc(db,'draftCharts','song')));
  await assertFails(setDoc(doc(db,'draftCharts','song'),draft('owner',3)));
  await assertFails(setDoc(doc(db,'publishedCharts','song'),{...draft(),draftRevision:2}));
});
it('isolates easy and hard drafts and only publishes the saved matching difficulty', async()=>{
  const db=google(),easy={...draft(),schemaVersion:2,difficulty:'easy'},hard={...draft(),schemaVersion:2,difficulty:'hard',json:'{"notes":[2]}'};
  const ref=(collectionName:string,level:string)=>doc(db,collectionName,'song','difficulties',level);
  await assertSucceeds(setDoc(doc(db,'draftCharts','song'),draft()));
  await assertSucceeds(setDoc(ref('draftCharts','easy'),easy));
  await assertSucceeds(setDoc(ref('draftCharts','hard'),hard));
  await assertFails(setDoc(ref('draftCharts','normal'),{...easy,difficulty:'normal'}));
  await assertFails(setDoc(ref('draftCharts','easy'),{...easy,revision:2,difficulty:'hard'}));
  await assertFails(setDoc(ref('publishedCharts','hard'),{...easy,draftRevision:1}));
  await assertSucceeds(setDoc(ref('publishedCharts','easy'),{...easy,draftRevision:1}));
  await assertFails(setDoc(ref('publishedCharts','hard'),{...hard,draftRevision:1,json:easy.json}));
  await assertSucceeds(setDoc(ref('publishedCharts','hard'),{...hard,draftRevision:1}));
  const anonymous=env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anonymous,'publishedCharts','song','difficulties','easy')));
  await assertFails(getDoc(doc(anonymous,'draftCharts','song','difficulties','easy')));
  await assertFails(setDoc(doc(anonymous,'publishedCharts','song','difficulties','easy'),{...easy,revision:2,draftRevision:1}));
  await assertFails(getDocs(collection(anonymous,'publishedCharts','song','difficulties')));
  await assertFails(setDoc(ref('draftCharts','easy'),{...easy,revision:2,extra:'unsupported'}));
  expect((await getDoc(doc(db,'draftCharts','song'))).data()?.revision).toBe(1);
});
