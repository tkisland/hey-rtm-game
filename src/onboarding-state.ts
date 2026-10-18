export const ONBOARDING_KEY = 'hey-rhythm-onboarding-v1';
export interface OnboardingState { seen: boolean; tutorial: boolean; timing: boolean }
let fallback: OnboardingState = {seen:false,tutorial:false,timing:false};
let sessionOnly = false;
const listeners = new Set<(state: OnboardingState, saved: boolean) => void>();
export function loadOnboarding(): OnboardingState {
  if(sessionOnly)return {...fallback};
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ONBOARDING_KEY) ?? '{}');
    const data = value && typeof value === 'object' ? value as Partial<OnboardingState> : {};
    return {seen:data.seen === true,tutorial:data.tutorial === true,timing:data.timing === true};
  } catch { return {...fallback}; }
}
export function updateOnboarding(change: Partial<OnboardingState>): boolean {
  const next = {...loadOnboarding(),...change}; fallback = next;
  let saved = false;
  try { localStorage.setItem(ONBOARDING_KEY,JSON.stringify(next)); saved = true; } catch { /* Session progress remains usable. */ }
  sessionOnly = !saved;
  for (const listener of listeners) listener({...next},saved);
  return saved;
}
export function subscribeOnboarding(listener: (state:OnboardingState,saved:boolean)=>void): () => void {
  listeners.add(listener); return () => listeners.delete(listener);
}
