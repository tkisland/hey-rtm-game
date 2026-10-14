import type { PlayNote } from './engine';
import { LANE_COLORS } from './colors';
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private observer: ResizeObserver;
  private flashes = new Map<number, number>();
  pressed = new Set<number>();
  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2Dを利用できません。別のブラウザをお試しください。');
    this.ctx = ctx;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }
  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width; this.height = rect.height;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  flash(lane: number, now: number): void { this.flashes.set(lane, now); }
  clearEffects(): void { this.flashes.clear(); }
  draw(notes: PlayNote[], time: number, travel: number, now: number): void {
    if (this.canvas.width !== Math.round(this.width * (window.devicePixelRatio || 1))) this.resize();
    const ctx = this.ctx, w = this.width, h = this.height;
    const laneWidth = w / 6, line = h - 25;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#121422'; ctx.fillRect(0, 0, w, h);
    for (let lane = 0; lane < 6; lane++) {
      const x = lane * laneWidth, color = LANE_COLORS[lane];
      ctx.fillStyle = lane % 2 ? '#191a2c' : '#151625'; ctx.fillRect(x, 0, laneWidth, h);
      const age = now - (this.flashes.get(lane) ?? -1000);
      const alpha = this.pressed.has(lane) ? 0.17 : Math.max(0, 1 - age / 220) * 0.3;
      if (alpha > 0) {
        const gradient = ctx.createLinearGradient(0, h, 0, 0);
        gradient.addColorStop(0, color); gradient.addColorStop(1, '#151625');
        ctx.globalAlpha = alpha; ctx.fillStyle = gradient; ctx.fillRect(x, 0, laneWidth, h); ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = '#ffffff0c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillStyle = color; ctx.globalAlpha = 0.15; ctx.fillRect(x + 3, line - 10, laneWidth - 6, 20); ctx.globalAlpha = 1;
    }
    // Decorative grid has no timing authority; notes are positioned directly from video time.
    ctx.strokeStyle = '#ffffff08';
    for (let y = line % 60; y < h; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, line); ctx.lineTo(w, line); ctx.stroke();
    for (const note of notes) {
      if (note.state !== 'pending') continue;
      const delta = note.time - time;
      if (delta > travel + 0.1 || delta < -0.2) continue;
      const y = line - delta / travel * line;
      const inset = Math.max(5, laneWidth * 0.12), x = note.lane * laneWidth + inset;
      const noteWidth = laneWidth - inset * 2;
      ctx.shadowBlur = 10; ctx.shadowColor = LANE_COLORS[note.lane];
      ctx.fillStyle = LANE_COLORS[note.lane]; ctx.beginPath(); ctx.roundRect(x, y - 6, noteWidth, 12, 4); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffffa0'; ctx.fillRect(x + 4, y - 4, Math.max(1, noteWidth - 8), 2);
    }
    const fade = ctx.createLinearGradient(0, 0, 0, 40);
    fade.addColorStop(0, '#121422'); fade.addColorStop(1, '#12142200'); ctx.fillStyle = fade; ctx.fillRect(0, 0, w, 40);
  }
  destroy(): void { this.observer.disconnect(); }
}
