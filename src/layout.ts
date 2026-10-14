/** Fit the runway using stable viewport and document coordinates, without reacting to tap focus. */
export function bindDockLayout(stage: HTMLElement, dock: HTMLElement): () => void {
  const controller = new AbortController();
  const root = document.documentElement;
  // svh is the viewport with browser chrome visible. Unlike dvh it does not grow/shrink
  // as the mobile address bar animates. The vh declaration is an older-browser fallback.
  const viewportReference = document.createElement('div');
  viewportReference.className = 'viewport-size-reference';
  viewportReference.setAttribute('aria-hidden', 'true');
  viewportReference.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100vh;height:100svh;visibility:hidden;pointer-events:none;contain:strict;';
  document.body.append(viewportReference);
  let frame = 0;
  const setDimension = (name: string, value: number) => {
    const dimension = `${Math.ceil(value)}px`;
    if (root.style.getPropertyValue(name) !== dimension) root.style.setProperty(name, dimension);
  };
  const measure = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const stableHeight = viewportReference.getBoundingClientRect().height;
      root.classList.toggle('compact-viewport', stableHeight <= 680);
      setDimension('--playfield-height', stableHeight);
      // Layout offsets do not depend on visualViewport offsets or scroll animation.
      let stageTop = 0;
      for (let node: HTMLElement | null = stage; node; node = node.offsetParent as HTMLElement | null) stageTop += node.offsetTop;
      setDimension('--stage-top', stageTop);
      setDimension('--dock-height', dock.getBoundingClientRect().height);
    });
  };
  const observer = new ResizeObserver(measure);
  observer.observe(viewportReference);
  observer.observe(dock);
  // Only content above the runway can change its document position. Watching main
  // would feed changes to the runway and result/feedback back into its own sizing.
  for (let ancestor: HTMLElement | null = stage; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
    for (let sibling = ancestor.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling instanceof HTMLElement) observer.observe(sibling);
    }
  }
  window.addEventListener('resize', measure, { signal: controller.signal });
  measure();
  return () => {
    controller.abort(); observer.disconnect(); cancelAnimationFrame(frame);
    viewportReference.remove(); root.classList.remove('compact-viewport');
    for (const name of ['--playfield-height', '--stage-top', '--dock-height']) root.style.removeProperty(name);
  };
}
