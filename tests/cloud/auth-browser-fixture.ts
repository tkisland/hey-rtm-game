// Test-only setup; this file is not a build entry and never reaches dist/.
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { cloudClient } from '../../src/cloud-auth';
import { cloudEmulators } from '../../src/cloud-config';
export async function signInGoogle(email: string): Promise<string> {
  if (!cloudEmulators) throw new Error('This fixture requires local emulators.');
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const token = `${encode({alg:'none',typ:'JWT'})}.${encode({iss:'https://accounts.google.com',aud:'demo-key',sub:email,email,email_verified:true,name:'Test admin'})}.`;
  const {auth}=await cloudClient();
  return (await signInWithCredential(auth,GoogleAuthProvider.credential(token))).user.uid;
}
