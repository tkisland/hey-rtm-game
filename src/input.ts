export const KEYS = ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'];

/** A pointer per finger, and independent keyboard state. No repeat hits or shared touch lock. */
export function bindInput(buttons: HTMLButtonElement[], onHit: (lane: number) => void, onPressed: (lanes: Set<number>) => void): () => void {
  const controller = new AbortController();
  const signal = controller.signal;
  const pointers = new Map<number, number>();
  const keys = new Set<number>();
  const render = () => {
    const active = new Set([...pointers.values(), ...keys]);
    buttons.forEach((button, lane) => button.classList.toggle('pressed', active.has(lane)));
    onPressed(active);
  };
  const releaseAll = () => { pointers.clear(); keys.clear(); render(); };
  buttons.forEach((button, lane) => {
    button.addEventListener('pointerdown', event => {
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
    button.addEventListener('pointercancel', up, { signal });
    button.addEventListener('lostpointercapture', up, { signal });
    button.addEventListener('contextmenu', event => event.preventDefault(), { signal });
    // Assistive technology and native Enter/Space activation have no pointerdown.
    button.addEventListener('click', event => { if (event.detail === 0) onHit(lane); }, { signal });
  });
  window.addEventListener('keydown', event => {
    const lane = KEYS.indexOf(event.code);
    const target = event.target as HTMLElement | null;
    if (lane < 0 || event.ctrlKey || event.altKey || event.metaKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    if (event.repeat || keys.has(lane)) return;
    keys.add(lane); render(); onHit(lane);
  }, { signal });
  window.addEventListener('keyup', event => {
    const lane = KEYS.indexOf(event.code);
    if (lane >= 0) { keys.delete(lane); render(); }
  }, { signal });
  window.addEventListener('blur', releaseAll, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); }, { signal });
  return () => { controller.abort(); releaseAll(); };
}
