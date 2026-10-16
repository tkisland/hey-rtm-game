import { LANE_COLORS } from './colors';
import { project } from './field-geometry';
import type { FieldGeometry } from './field-geometry';

/** Six anonymous performers at the source of the lanes. No movement of the input field. */
export function drawStage(ctx: CanvasRenderingContext2D, field: FieldGeometry, responses: readonly number[]): void {
  const { width, origin } = field;
  const top = Math.max(12, origin - 36), floor = origin - 3;
  const shape = (points: number[][]) => {
    ctx.beginPath(); points.forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.closePath(); ctx.fill();
  };
  ctx.save();
  // Overhead lights frame the performers without covering approaching notes.
  const wash = ctx.createLinearGradient(0, top - 10, 0, origin);
  wash.addColorStop(0, '#e693ff08'); wash.addColorStop(1, '#e693ff28');
  ctx.fillStyle = wash; shape([[width * .12, top - 12], [width * .88, top - 12], [width, origin], [0, origin]]);
  for (let lane = 0; lane < 6; lane++) {
    const x = project(field, lane, 0).x, color = LANE_COLORS[lane];
    const pulse = responses[lane] ?? 0, r = Math.min(4, field.cell * .08);
    const light = ctx.createLinearGradient(x, top - 12, x, floor);
    light.addColorStop(0, color + '00'); light.addColorStop(1, color + (pulse > 0 ? '50' : '18'));
    ctx.fillStyle = light; shape([[x - 3, top - 12], [x + 3, top - 12], [x + field.cell * .35, floor], [x - field.cell * .35, floor]]);
    ctx.fillStyle = '#242037';
    ctx.beginPath(); ctx.arc(x, floor - 20, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = color + (pulse > 0 ? 'd0' : '70');
    shape([[x - r, floor - 14], [x + r, floor - 14], [x + r * 1.8, floor - 3], [x - r * 1.8, floor - 3]]);
    // Raised arm with a small, bright response at the hand when a note is emitted.
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x + r, floor - 12); ctx.lineTo(x + r * 2, floor - 19); ctx.stroke();
    ctx.fillStyle = pulse > 0 ? '#fff' : color;
    ctx.globalAlpha = .4 + pulse * .6;
    ctx.beginPath(); ctx.arc(x + r * 2, floor - 19, 1.5 + pulse * 2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  }
  const rim = ctx.createLinearGradient(0, 0, width, 0);
  LANE_COLORS.forEach((color, i) => rim.addColorStop(i / 5, color));
  ctx.fillStyle = '#30273f'; shape([[width * .06, floor], [width * .94, floor], [width * .98, origin + 2], [width * .02, origin + 2]]);
  ctx.strokeStyle = rim; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(width * .02, origin + 2); ctx.lineTo(width * .98, origin + 2); ctx.stroke();
  ctx.restore();
}
