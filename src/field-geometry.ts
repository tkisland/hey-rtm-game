import { WINDOWS } from './engine';

export type HitZone = 'PERFECT' | 'GREAT' | 'GOOD';
export interface Target { x: number; y: number; width: number; height: number }
export interface FieldGeometry {
  width: number; height: number; origin: number; cell: number; margin: number;
  near: number; approach: number; padWidth: number; padHeight: number; targets: Target[]; pads: Target[];
}
export interface FieldPoint { x: number; y: number; width: number; scale: number }
export function fieldGeometry(width: number, height: number): FieldGeometry {
  const margin = Math.min(8, width * 0.025), cell = (width - 2 * margin) / 6;
  const padWidth = Math.min(72, Math.max(44, cell * 0.86));
  const padHeight = Math.min(68, Math.max(60, height * 0.15));
  const origin = Math.min(76, height * 0.25); // Room for the stage; the travel time stays unchanged.
  // This clearance is in addition to the canvas's safe-area inset.
  const padY = height - 44 - padHeight / 2;
  // Keep even the latest GOOD above the thumb area, at the fastest supported speed (1s).
  const lateProgress = 1 + WINDOWS.GOOD;
  const lateBottom = padY - padHeight / 2 - 16;
  const near = Math.max(origin, (lateBottom + (lateProgress - 1) * origin) / lateProgress);
  const approach = near - origin;
  const field: FieldGeometry = { width, height, origin, cell, margin, near, approach, padWidth, padHeight, targets: [], pads: [] };
  field.targets = Array.from({ length: 6 }, (_, lane) => {
    const point = project(field, lane, 1);
    return { x: point.x, y: point.y, width: padWidth, height: 20 };
  });
  field.pads = field.targets.map(target => ({ ...target, y: padY, height: padHeight }));
  return field;
}
/** Equal vertical pixels per second in every lane, with only a mild visual taper. */
export function project(field: FieldGeometry, lane: number, progress: number): FieldPoint {
  const scale = 0.82 + 0.18 * Math.min(1, Math.max(0, progress));
  const targetX = field.margin + (lane + 0.5) * field.cell;
  return { x: field.width / 2 + (targetX - field.width / 2) * scale,
    y: field.near + (progress - 1) * field.approach, width: field.padWidth * 0.86 * scale, scale };
}
export function timingBands(field: FieldGeometry, lane: number, travel: number) {
  return (['GOOD', 'GREAT', 'PERFECT'] as const).map(kind => ({ kind,
    top: project(field, lane, 1 - WINDOWS[kind] / travel), bottom: project(field, lane, 1 + WINDOWS[kind] / travel),
  }));
}
/** Bind thumb pads below the receptors; expose the receptor position for visible feedback. */
export function bindTargets(canvas: HTMLCanvasElement, elements: HTMLElement[]): () => void {
  const update = () => {
    const rect = canvas.getBoundingClientRect(), field = fieldGeometry(rect.width, rect.height);
    elements.forEach((element, lane) => {
      const target = field.targets[lane], pad = field.pads[lane];
      element.style.left = `${pad.x}px`; element.style.top = `${pad.y}px`;
      element.style.width = `${pad.width}px`; element.style.height = `${pad.height}px`;
      element.style.setProperty('--receptor-y', `${target.y - pad.y + pad.height / 2}px`);
    });
  };
  const observer = new ResizeObserver(update); observer.observe(canvas); update();
  return () => observer.disconnect();
}
