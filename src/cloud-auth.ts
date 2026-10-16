import { getApps, initializeApp } from 'firebase/app';
import { browserSessionPersistence, connectAuthEmulator, getAuth, GoogleAuthProvider, onAuthStateChanged, setPersistence, signInWithPopup, signOut } from 'firebase/auth';
import type { Auth, User } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDocFromServer, getFirestore, onSnapshot } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { cloudConfig, cloudEmulators } from './cloud-config';

let client: Promise<{ auth: Auth; db: Firestore }> | undefined;
export function cloudClient() {
  return client ??= (async () => {
    if (!cloudConfig) throw new Error('管理者ログインは準備中です。');
    const app = getApps().find(app => app.name === 'hey-admin') ?? initializeApp(cloudConfig, 'hey-admin');
    const auth = getAuth(app), db = getFirestore(app);
    if (cloudEmulators) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    await setPersistence(auth, browserSessionPersistence);
    return { auth, db };
  })();
}
const isGoogleUser = (user: User) => user.emailVerified && user.providerData.some(provider => provider.providerId === 'google.com');
export async function loginWithGoogle(): Promise<void> {
  const { auth } = await cloudClient();
  const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, provider);
}
export async function logout(): Promise<void> { await signOut((await cloudClient()).auth); }
export async function requireCloudAdmin(): Promise<User> {
  const { auth, db } = await cloudClient(); await auth.authStateReady();
  const user = auth.currentUser;
  if (!user || !isGoogleUser(user)) throw new Error('管理者としてGoogleログインしてください。');
  const role = await getDocFromServer(doc(db, 'admins', user.uid));
  if (!role.exists() || role.data().enabled !== true || auth.currentUser?.uid !== user.uid) throw new Error('このアカウントには管理者権限がありません。');
  return user;
}
export interface AccessState { phase: 'checking' | 'out' | 'denied' | 'allowed' | 'error'; user: User | null }
export function watchAdminAccess(callback: (state: AccessState) => void): () => void {
  let stopped = false, generation = 0, stopAuth = () => {}, stopRole = () => {};
  void cloudClient().then(({ auth, db }) => {
    if (stopped) return;
    stopAuth = onAuthStateChanged(auth, user => {
      stopRole(); const current = ++generation;
      if (!user || !isGoogleUser(user)) { callback({phase:user ? 'denied' : 'out', user}); return; }
      callback({phase:'checking', user});
      stopRole = onSnapshot(doc(db, 'admins', user.uid), {includeMetadataChanges:true}, snapshot => {
        if (stopped || current !== generation) return;
        callback({phase:snapshot.metadata.fromCache ? 'checking' : snapshot.exists() && snapshot.data().enabled === true ? 'allowed' : 'denied', user});
      }, () => { if (!stopped && current === generation) callback({phase:'denied', user}); });
    }, () => callback({phase:'error', user:null}));
  }).catch(() => { if (!stopped) callback({phase:'error', user:null}); });
  return () => { stopped = true; generation++; stopAuth(); stopRole(); };
}
