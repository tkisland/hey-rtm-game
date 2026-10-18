import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
it('loads only explicit completion flags and recovers from damaged stored data',async()=>{
  let value='{"seen":true,"tutorial":true,"timing":"true"}';
  vi.stubGlobal('localStorage',{getItem:()=>value,setItem:(_:string,next:string)=>{value=next;}});
  const state=await import('../src/onboarding-state');
  expect(state.loadOnboarding()).toEqual({seen:true,tutorial:true,timing:false});
  value='damaged';expect(state.loadOnboarding()).toEqual({seen:false,tutorial:false,timing:false});
  expect(state.updateOnboarding({timing:true})).toBe(true);
  expect(state.loadOnboarding()).toEqual({seen:false,tutorial:false,timing:true});
});
it('retains both completed steps in the current page when writes are blocked',async()=>{
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{throw new Error('blocked');}});
  const state=await import('../src/onboarding-state');
  expect(state.updateOnboarding({seen:true,tutorial:true})).toBe(false);
  expect(state.updateOnboarding({timing:true})).toBe(false);
  expect(state.loadOnboarding()).toEqual({seen:true,tutorial:true,timing:true});
});
