import { WINDOWS } from './engine';

export type HitZone = 'PERFECT' | 'GREAT' | 'GOOD';
export interface Target { x: number; y: number; width: number; height: number }
export interface FieldGeometry {
  width: number; height: number; origin: number; cell: number; margin: number;
  near: number; step: number; padWidth: number; padHeight: number; targets: Target[];
}
export interface FieldPoint { x: number; y: number; width: number; scale: number }
/** A shallow perspective, with a gentle, continuous acceleration towards the receptors. */
export function depth(progress: number): number { return 0.8 * progress + 0.2 * progress * progress; }
export function fieldGeometry(width: number, height: number): FieldGeometry {
  const margin = Math.min(8, width * 0.025), cell = (width - 2 * margin) / 6;
  const padWidth = Math.min(72, Math.max(44, cell * 0.86));
  const padHeight = Math.min(62, Math.max(48, padWidth * 0.86));
  const origin = Math.min(78, height * 0.32);
  // Fit late GOOD at the fastest supported speed (1s). Current speed/compensation
  // never move the buttons; each timing-window edge is projected independently.
  const lateDepth = depth(1 + WINDOWS.GOOD);
  const near = Math.max(origin, Math.min(height - 16 - padHeight / 2, (height - 8 + (lateDepth - 1) * origin) / lateDepth));
  const step = Math.min(24, cell * 0.45, Math.max(0, (near - origin - 24) / 2));
  const field: FieldGeometry = { width, height, origin, cell, margin, near, step, padWidth, padHeight, targets: [] };
  field.targets = Array.from({ length: 6 }, (_, lane) => {
    const point = project(field, lane, 1);
    return { x: point.x, y: point.y, width: padWidth, height: padHeight };
  });
  return field;
}
/** Fractional lanes also project the shared lane boundaries onto the V-shaped plane. */
export function project(field: FieldGeometry, lane: number, progress: number): FieldPoint {
  const z = depth(progress), scale = 0.48 + 0.52 * Math.min(1, Math.max(0, z));
  const targetX = field.margin + (lane + 0.5) * field.cell;
  const targetY = field.near - field.step * Math.max(0, Math.abs(lane - 2.5) - 0.5);
  return { x: field.width / 2 + (targetX - field.width / 2) * scale,
    y: field.origin + (targetY - field.origin) * z, width: field.padWidth * 0.86 * scale, scale };
}
export function timingBands(field: FieldGeometry, lane: number, travel: number) {
  return (['GOOD', 'GREAT', 'PERFECT'] as const).map(kind => ({ kind,
    top: project(field, lane, 1 - WINDOWS[kind] / travel), bottom: project(field, lane, 1 + WINDOWS[kind] / travel),
  }));
}
/** Real buttons and readonly preview pads use exactly the renderer's target coordinates. */
export function bindTargets(canvas: HTMLCanvasElement, elements: HTMLElement[]): () => void {
  const update = () => {
    const rect = canvas.getBoundingClientRect(), field = fieldGeometry(rect.width, rect.height);
    elements.forEach((element, lane) => {
      const target = field.targets[lane];
      element.style.left = `${target.x}px`; element.style.top = `${target.y}px`;
      element.style.width = `${target.width}px`; element.style.height = `${target.height}px`;
    });
  };
  const observer = new ResizeObserver(update); observer.observe(canvas); update();
  return () => observer.disconnect();
}
