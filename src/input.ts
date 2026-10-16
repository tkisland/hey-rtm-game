import type { InputGesture } from './engine';
export const KEYS = ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'];

/** A pointer per finger, and independent keyboard state. No repeat hits or shared touch lock. */
export function bindInput(buttons: HTMLButtonElement[], onHit: (lane: number, gesture?: InputGesture) => void, onPressed: (lanes: Set<number>, reason: 'change' | 'cancel') => void, blocked: () => boolean = () => false,
  options: {sweepCrossings?: boolean; onGestureEnd?: (id:string) => void} = {}): () => void {
  const controller = new AbortController();
  const signal = controller.signal;
  const pointers = new Map<number, number>();
  const keys = new Set<number>();
  const nativeKeys = new Map<string, number>();
  const render = (reason: 'change' | 'cancel' = 'change') => {
    const active = new Set([...pointers.values(), ...keys, ...nativeKeys.values()]);
    buttons.forEach((button, lane) => button.classList.toggle('pressed', active.has(lane)));
    onPressed(active, reason);
  };
  const releaseAll = () => { for (const id of pointers.keys()) options.onGestureEnd?.(`pointer:${id}`); options.onGestureEnd?.('keyboard'); pointers.clear(); keys.clear(); nativeKeys.clear(); render('cancel'); };
  buttons.forEach((button, lane) => {
    button.addEventListener('pointerdown', event => {
      if (blocked()) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      // Touch focus can scroll the visual viewport on mobile Safari, even with preventScroll.
      if (event.pointerType === 'mouse') button.focus({ preventScroll: true });
      button.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, lane);
      render();
      onHit(lane, {id:`pointer:${event.pointerId}`});
    }, { signal });
    button.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId) || blocked()) return;
      // The gaps belong to the nearest lane too: sliding never has a dead strip.
      // Require the existing pad row, so dragging over settings cannot hit a lane.
      const rects = buttons.map(button => button.getBoundingClientRect());
      const first = rects[0], last = rects.at(-1);
      if (!first || !last || event.clientY < first.top || event.clientY > first.bottom) { options.onGestureEnd?.(`pointer:${event.pointerId}`); return; }
      let next = 0;
      rects.forEach((rect, lane) => { if (Math.abs(event.clientX - rect.x - rect.width / 2) < Math.abs(event.clientX - rects[next].x - rects[next].width / 2)) next = lane; });
      if (next === pointers.get(event.pointerId)) return;
      const previous = pointers.get(event.pointerId)!;
      event.preventDefault(); pointers.set(event.pointerId, next); render();
      if (options.sweepCrossings) for (let crossed = previous + Math.sign(next - previous); crossed !== next; crossed += Math.sign(next - previous)) onHit(crossed, {id:`pointer:${event.pointerId}`, sweepOnly:true});
      onHit(next, {id:`pointer:${event.pointerId}`});
    }, { signal });
    const up = (event: PointerEvent) => { pointers.delete(event.pointerId); options.onGestureEnd?.(`pointer:${event.pointerId}`); render(); };
    button.addEventListener('pointerup', up, { signal });
    button.addEventListener('pointercancel', event => { pointers.delete(event.pointerId); options.onGestureEnd?.(`pointer:${event.pointerId}`); render('cancel'); }, { signal });
    button.addEventListener('lostpointercapture', event => {
      if (!pointers.delete(event.pointerId)) return;
      options.onGestureEnd?.(`pointer:${event.pointerId}`);
      render('cancel');
    }, { signal });
    button.addEventListener('contextmenu', event => event.preventDefault(), { signal });
    // Safari may still recognize double-tap zoom from compatibility touch events.
    button.addEventListener('touchend', event => event.preventDefault(), { signal, passive: false });
    button.addEventListener('dblclick', event => event.preventDefault(), { signal });
    // Assistive technology and native Enter/Space activation have no pointerdown.
    button.addEventListener('click', event => { if (event.detail === 0 && !blocked()) onHit(lane); }, { signal });
  });
  window.addEventListener('keydown', event => {
    if (blocked()) return;
    const buttonLane = buttons.indexOf(event.target as HTMLButtonElement);
    if ((event.code === 'Space' || event.code === 'Enter') && buttonLane >= 0 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      if (event.repeat || nativeKeys.has(event.code)) return;
      nativeKeys.set(event.code, buttonLane); render(); onHit(buttonLane); return;
    }
    const lane = KEYS.indexOf(event.code);
    const target = event.target as HTMLElement | null;
    if (lane < 0 || event.ctrlKey || event.altKey || event.metaKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    if (event.repeat || keys.has(lane)) return;
    keys.add(lane); render(); onHit(lane);
  }, { signal });
  window.addEventListener('keyup', event => {
    if (nativeKeys.delete(event.code)) { event.preventDefault(); render(); }
    const lane = KEYS.indexOf(event.code);
    if (lane >= 0) { keys.delete(lane); render(); }
  }, { signal });
  window.addEventListener('blur', releaseAll, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); }, { signal });
  return () => { controller.abort(); releaseAll(); };
}
