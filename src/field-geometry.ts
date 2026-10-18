import { WINDOWS } from './engine';

export type HitZone = 'PERFECT' | 'GREAT' | 'GOOD';
export interface Target { x: number; y: number; width: number; height: number }
export interface FieldGeometry {
  width: number; height: number; origin: number; cell: number; margin: number; centerSpace: number;
  near: number; approach: number; padWidth: number; padHeight: number; targets: Target[]; pads: Target[];
}
export interface FieldPoint { x: number; y: number; width: number; scale: number }
export function fieldGeometry(width: number, height: number): FieldGeometry {
  // Six equal playable lanes; reserve 60% of the original empty center lane.
  // On narrow screens, shrink only the empty lane to keep every button at least 44px.
  const margin = Math.max(0, Math.min(8, (width - 6 * 44) / 2));
  const available = width - 2 * margin;
  const centerSpace = .6 * Math.max(0, Math.min(available / 7, available - 6 * 44));
  const cell = (available - centerSpace) / 6;
  const padWidth = Math.min(80, Math.max(44, cell * .96));
  const padHeight = Math.min(74, Math.max(60, height * 0.15));
  const origin = Math.min(148, Math.max(28, (height - 240) * .28));
  // Lift the row toward resting thumbs; short fields retain their usable runway.
  // This 44–92px clearance is in addition to the canvas's safe-area inset.
  const bottomClearance = 44 + Math.min(48, Math.max(0, (height - 224) * .16));
  const padY = height - bottomClearance - padHeight / 2;
  // Keep even the latest GOOD above the thumb area, at the fastest supported speed (1s).
  const lateProgress = 1 + WINDOWS.GOOD;
  const lateBottom = padY - padHeight / 2 - 16;
  const near = Math.max(origin, (lateBottom + (lateProgress - 1) * origin) / lateProgress);
  const approach = near - origin;
  const field: FieldGeometry = { width, height, origin, cell, margin, centerSpace, near, approach, padWidth, padHeight, targets: [], pads: [] };
  field.targets = Array.from({ length: 6 }, (_, lane) => {
    const point = project(field, lane, 1);
    return { x: point.x, y: point.y, width: padWidth, height: 20 };
  });
  field.pads = field.targets.map(target => ({ ...target, y: padY, height: padHeight }));
  return field;
}
/** Concert perspective changes horizontal width only; all lanes keep equal vertical speed. */
export function project(field: FieldGeometry, lane: number, progress: number, laneEdge = 0): FieldPoint {
  const scale = 0.62 + 0.38 * Math.min(1, Math.max(0, progress));
  // Fractional lane centers remain continuous for cross-lane paths. Edges are
  // offsets within a single lane, so the white/red surfaces never absorb the blank.
  const split = Math.max(0, Math.min(1, lane - 2));
  const targetX = field.margin + (lane + 0.5 + laneEdge) * field.cell + field.centerSpace * split;
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
    // End the visible concert frame just below the console; browser clearance stays outside it.
    canvas.parentElement!.style.setProperty('--frame-bottom', `${field.pads[0].y + field.padHeight / 2 + 14}px`);
    elements.forEach((element, lane) => {
      const target = field.targets[lane], pad = field.pads[lane];
      element.style.left = `${pad.x}px`; element.style.top = `${pad.y}px`;
      element.style.width = `${pad.width}px`; element.style.height = `${pad.height}px`;
      const extra = Math.min(32, Math.max(0,pad.y - pad.height / 2 - target.y - target.height / 2 - 4));
      element.style.setProperty('--hit-extra',`${extra}px`);
      element.style.setProperty('--receptor-y', `${target.y - pad.y + pad.height / 2}px`);
    });
  };
  const observer = new ResizeObserver(update); observer.observe(canvas); update();
  return () => observer.disconnect();
}
