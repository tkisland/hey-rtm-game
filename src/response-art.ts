/** Compact vector marks; callers choose a size that fits inside the timing bar. */
export function responseMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, star = false): void {
  ctx.beginPath();
  if (star) {
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 5, radius = size * (i % 2 ? .45 : 1);
      const px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  } else {
    ctx.moveTo(x, y + size * .65);
    ctx.bezierCurveTo(x - size * 1.25, y - size * .1, x - size * .65, y - size * 1.1, x, y - size * .4);
    ctx.bezierCurveTo(x + size * .65, y - size * 1.1, x + size * 1.25, y - size * .1, x, y + size * .65);
    ctx.closePath();
  }
  ctx.fill();
}
