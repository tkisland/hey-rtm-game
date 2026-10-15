/** Pin the unified field using stable viewport/document coordinates, never tap focus. */
export function bindDockLayout(stage: HTMLElement, dock: HTMLElement): () => void {
  const controller = new AbortController(), root = document.documentElement, host = stage.parentElement!;
  const viewportReference = document.createElement('div');
  viewportReference.className = 'viewport-size-reference'; viewportReference.setAttribute('aria-hidden', 'true');
  viewportReference.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100vh;height:100svh;visibility:hidden;pointer-events:none;contain:strict;';
  document.body.append(viewportReference);
  let frame = 0;
  const set = (name: string, value: number) => {
    const dimension = `${Math.round(value * 100) / 100}px`;
    if (root.style.getPropertyValue(name) !== dimension) root.style.setProperty(name, dimension);
  };
  const measure = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const stableHeight = viewportReference.getBoundingClientRect().height;
      root.classList.toggle('compact-viewport', stableHeight <= 680);
      let naturalTop = 0;
      for (let node: HTMLElement | null = host; node; node = node.offsetParent as HTMLElement | null) naturalTop += node.offsetTop;
      const rect = host.getBoundingClientRect();
      const height = Math.min(480, Math.max(Math.min(224, stableHeight - 12), stableHeight - naturalTop));
      set('--playfield-height', stableHeight); set('--surface-height', height);
      set('--surface-top', stableHeight - height); set('--surface-left', rect.left); set('--surface-width', rect.width);
    });
  };
  const observer = new ResizeObserver(measure);
  observer.observe(viewportReference); observer.observe(host); observer.observe(dock);
  for (let ancestor: HTMLElement | null = host; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
    for (let sibling = ancestor.previousElementSibling; sibling; sibling = sibling.previousElementSibling) if (sibling instanceof HTMLElement) observer.observe(sibling);
  }
  window.addEventListener('resize', measure, { signal: controller.signal }); measure();
  return () => {
    controller.abort(); observer.disconnect(); cancelAnimationFrame(frame); viewportReference.remove(); root.classList.remove('compact-viewport');
    for (const name of ['--playfield-height', '--surface-height', '--surface-top', '--surface-left', '--surface-width']) root.style.removeProperty(name);
  };
}
