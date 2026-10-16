import { parseCloudConfig } from './cloud-schema';
export const cloudConfig = parseCloudConfig(typeof __FIREBASE_CONFIG__ === 'undefined' ? null : __FIREBASE_CONFIG__);
export const cloudEmulators = typeof __FIREBASE_EMULATORS__ === 'undefined' ? false : __FIREBASE_EMULATORS__;
