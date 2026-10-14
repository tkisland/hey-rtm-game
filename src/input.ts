export const KEYS = ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'];

/** A pointer per finger, and independent keyboard state. No repeat hits or shared touch lock. */
export function bindInput(buttons: HTMLButtonElement[], onHit: (lane: number) => void, onPressed: (lanes: Set<number>, reason: 'change' | 'cancel') => void, blocked: () => boolean = () => false): () => void {
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
  const releaseAll = () => { pointers.clear(); keys.clear(); nativeKeys.clear(); render('cancel'); };
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
      onHit(lane);
    }, { signal });
    const up = (event: PointerEvent) => { pointers.delete(event.pointerId); render(); };
    button.addEventListener('pointerup', up, { signal });
    button.addEventListener('pointercancel', event => { pointers.delete(event.pointerId); render('cancel'); }, { signal });
    button.addEventListener('lostpointercapture', event => {
      if (!pointers.delete(event.pointerId)) return;
      render('cancel');
    }, { signal });
    button.addEventListener('contextmenu', event => event.preventDefault(), { signal });
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
