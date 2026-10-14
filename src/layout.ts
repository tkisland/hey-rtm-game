/** Fit the note runway above the mobile dock using actual layout, not a device-height guess. */
export function bindDockLayout(stage: HTMLElement, dock: HTMLElement): () => void {
  const controller = new AbortController();
  let frame = 0;
  const measure = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      document.documentElement.style.setProperty('--stage-top', `${Math.ceil(stage.getBoundingClientRect().top + window.scrollY)}px`);
      document.documentElement.style.setProperty('--dock-height', `${Math.ceil(dock.getBoundingClientRect().height)}px`);
    });
  };
  const observer = new ResizeObserver(measure);
  observer.observe(dock);
  observer.observe(document.querySelector('main')!);
  window.addEventListener('resize', measure, { signal: controller.signal });
  window.visualViewport?.addEventListener('resize', measure, { signal: controller.signal });
  measure();
  return () => { controller.abort(); observer.disconnect(); cancelAnimationFrame(frame); };
}
