import type { PlayNote } from './engine';
import { LANE_COLORS } from './colors';
import { chordGroups, noteThickness } from './note-display';
import type { ChartNote } from './chart';
import { fieldGeometry } from './field-geometry';
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private observer: ResizeObserver;
  private flashes = new Map<number, number>();
  pressed = new Set<number>();
  private cachedNotes: PlayNote[] | null = null;
  private chords: ChartNote[][] = [];
  private chordIds = new Set<number>();
  private gaps = new Map<number, number>();
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
  draw(notes: PlayNote[], time: number, travel: number, now: number, size = 100, bpm = 140, inputOffsetMs = 0): void {
    if (this.canvas.width !== Math.round(this.width * (window.devicePixelRatio || 1))) this.resize();
    const ctx = this.ctx, w = this.width, h = this.height;
    const laneWidth = w / 6, field = fieldGeometry(h, travel, inputOffsetMs);
    const line = field.center, inset = Math.max(5, laneWidth * 0.12), noteWidth = laneWidth - inset * 2;
    if (this.cachedNotes !== notes) {
      this.cachedNotes = notes; this.chords = chordGroups(notes); this.chordIds = new Set(this.chords.flat().map(note => note.id)); this.gaps.clear();
      for (let lane = 0; lane < 6; lane++) {
        const ordered = notes.filter(note => note.lane === lane).sort((a, b) => a.time - b.time);
        ordered.forEach((note, i) => this.gaps.set(note.id, Math.min(note.time - (ordered[i - 1]?.time ?? -Infinity), (ordered[i + 1]?.time ?? Infinity) - note.time)));
      }
    }
    const yAt = (seconds: number) => field.anchor + (time - seconds) * field.speed;
    const active = (note: ChartNote) => { const state = (note as PlayNote).state; return state === 'pending' || state === 'holding'; };
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
      ctx.fillStyle = color;
      for (const band of field.bands) {
        ctx.globalAlpha = band.kind === 'PERFECT' ? 0.12 : 0.08;
        ctx.fillRect(x + inset, band.top, noteWidth, band.bottom - band.top);
      }
      ctx.globalAlpha = 1;
    }
    // Decorative grid has no timing authority; notes use the video-anchored interpolated clock shared with judgement.
    ctx.strokeStyle = '#ffffff08';
    for (let y = field.anchor % 60; y < h; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, line); ctx.lineTo(w, line); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    // A shared horizontal link and diamond on each head identify a chord without merging judgement.
    for (const group of this.chords) {
      const visible = group.filter(active);
      if (visible.length < 2) continue;
      const y = visible.every(note => (note as PlayNote).state === 'holding') ? line : yAt(group[0].time);
      if (y < -10 || y > h + 10) continue;
      ctx.strokeStyle = '#ffe77999'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo((Math.min(...visible.map(note => note.lane)) + 0.5) * laneWidth, y); ctx.lineTo((Math.max(...visible.map(note => note.lane)) + 0.5) * laneWidth, y); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const note of notes) {
      if (!active(note)) continue;
      const head = note.state === 'holding' ? line : yAt(note.time);
      const tail = note.type === 'hold' ? note.state === 'holding' ? Math.min(line, yAt(note.endTime)) : yAt(note.endTime) : head;
      if (head < -20 || tail > h + 20) continue;
      const x = note.lane * laneWidth + inset, color = LANE_COLORS[note.lane];
      const spacing = Math.min(60 / bpm / 4, this.gaps.get(note.id) ?? Infinity) * field.speed;
      const thickness = noteThickness(size, spacing, 8);
      if (note.type === 'hold') {
        const center = x + noteWidth / 2, top = Math.max(-20, tail), bottom = Math.min(h + 12, head);
        ctx.fillStyle = `${color}${note.state === 'holding' ? '90' : '40'}`; ctx.fillRect(center - noteWidth * 0.22, top, noteWidth * 0.44, Math.max(0, bottom - top));
        ctx.strokeStyle = color; ctx.lineWidth = note.state === 'holding' ? 3 : 1;
        ctx.strokeRect(center - noteWidth * 0.22, top, noteWidth * 0.44, Math.max(0, bottom - top)); ctx.lineWidth = 1;
        ctx.fillStyle = color; ctx.fillRect(x, tail - thickness / 2, noteWidth, thickness);
        if (note.state === 'holding') { ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('HOLD', center, line - 16); ctx.textAlign = 'start'; }
      }
      ctx.shadowBlur = 3; ctx.shadowColor = color; ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(x, head - thickness / 2, noteWidth, thickness, Math.min(3, thickness / 2)); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffffa0'; ctx.fillRect(x + 4, head - thickness / 2, Math.max(1, noteWidth - 8), 1);
      if (this.chordIds.has(note.id)) {
        const center = x + noteWidth / 2, radius = Math.max(2, Math.min(4, thickness / 2));
        ctx.strokeStyle = '#fff'; ctx.fillStyle = '#10111c'; ctx.beginPath(); ctx.moveTo(center, head - radius); ctx.lineTo(center + radius, head); ctx.lineTo(center, head + radius); ctx.lineTo(center - radius, head); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
    const fade = ctx.createLinearGradient(0, 0, 0, 40);
    fade.addColorStop(0, '#121422'); fade.addColorStop(1, '#12142200'); ctx.fillStyle = fade; ctx.fillRect(0, 0, w, 40);
  }
  destroy(): void { this.observer.disconnect(); }
}
