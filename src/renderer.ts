import type { PlayNote } from './engine';
import { WINDOWS, playLane } from './engine';
import { laneAt } from './chart';
import { LANE_COLORS } from './colors';
import { chordCurve, chordGroups, noteThickness } from './note-display';
import type { Chart, ChartNote } from './chart';
import { beatsBetween } from './tempo';
import { fieldGeometry, project, timingBands } from './field-geometry';
import type { FieldGeometry, FieldPoint, HitZone } from './field-geometry';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private field!: FieldGeometry;
  private observer: ResizeObserver;
  private flashes = new Map<number, { time: number; kind: HitZone }>();
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  pressed = new Set<number>();
  private cachedNotes: PlayNote[] | null = null;
  private chords: ChartNote[][] = [];
  private chordIds = new Set<number>();
  private boxes: ChartNote[][] = [];
  private gaps = new Map<number, number>();
  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2Dを利用できません。別のブラウザをお試しください。');
    this.ctx = ctx;
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas); this.resize();
  }
  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.field = fieldGeometry(rect.width, rect.height);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(rect.width * dpr); this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  flash(lane: number, now: number, kind: HitZone = 'PERFECT'): void { this.flashes.set(lane, { time: now, kind }); }
  clearEffects(): void { this.flashes.clear(); }
  private polygon(points: { x: number; y: number }[], fill = true): void {
    const ctx = this.ctx; ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach(point => ctx.lineTo(point.x, point.y)); ctx.closePath();
    if (fill) ctx.fill(); else ctx.stroke();
  }
  private ribbon(top: FieldPoint, bottom: FieldPoint, factor = 0.5): void {
    this.polygon([{ x: top.x - top.width * factor, y: top.y }, { x: top.x + top.width * factor, y: top.y },
      { x: bottom.x + bottom.width * factor, y: bottom.y }, { x: bottom.x - bottom.width * factor, y: bottom.y }]);
  }
  draw(notes: PlayNote[], time: number, travel: number, now: number, size = 100, bpm = 140, inputOffsetMs = 0, playing = true, chart?: Chart): void {
    if (this.canvas.width !== Math.round(this.field.width * (window.devicePixelRatio || 1))) this.resize();
    const ctx = this.ctx, field = this.field, w = field.width, h = field.height;
    // Match the input clock so every compensated PERFECT arrives at a fixed button.
    const judgeTime = time - inputOffsetMs / 1000;
    const progressAt = (seconds: number) => 1 + (judgeTime - seconds) / travel;
    if (this.cachedNotes !== notes) {
      this.cachedNotes = notes; this.chords = chordGroups(notes); this.chordIds = new Set(this.chords.flat().map(note => note.id)); this.gaps.clear();
      const boxes = new Map<number, ChartNote[]>();
      for (const note of notes) if (note.boxId) { const group = boxes.get(note.boxId) ?? []; group.push(note); boxes.set(note.boxId, group); }
      this.boxes = [...boxes.values()];
      for (let lane = 0; lane < 6; lane++) {
        const ordered = notes.filter(note => note.lane === lane).sort((a, b) => a.time - b.time);
        ordered.forEach((note, i) => this.gaps.set(note.id, Math.min(note.time - (ordered[i - 1]?.time ?? -Infinity), (ordered[i + 1]?.time ?? Infinity) - note.time)));
      }
    }
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#0e1120'; ctx.fillRect(0, 0, w, h);
    const padTop = field.pads[0].y - field.padHeight / 2 - 8;
    ctx.fillStyle = '#090b16'; ctx.fillRect(0, padTop, w, h - padTop);
    ctx.fillStyle = '#ffffff12'; ctx.fillRect(0, padTop, w, 1);
    const end = 1 + WINDOWS.GOOD;
    for (let lane = 0; lane < 6; lane++) {
      const color = LANE_COLORS[lane];
      // Taper ends at PERFECT; include that corner so the runway follows late notes too.
      const edges = [project(field, lane - 0.49, 0), project(field, lane + 0.49, 0),
        project(field, lane + 0.49, 1), project(field, lane + 0.49, end),
        project(field, lane - 0.49, end), project(field, lane - 0.49, 1)];
      ctx.fillStyle = lane % 2 ? '#1c2034' : '#171b2e'; this.polygon(edges);
      ctx.strokeStyle = '#ffffff12'; ctx.lineWidth = 1; this.polygon(edges, false);
      const age = now - (this.flashes.get(lane)?.time ?? -1000);
      const alpha = this.pressed.has(lane) ? 0.2 : Math.max(0, 1 - age / 220) * 0.32;
      if (alpha > 0) { ctx.globalAlpha = alpha; ctx.fillStyle = color; this.polygon(edges); ctx.globalAlpha = 1; }
      ctx.fillStyle = color;
      for (const band of timingBands(field, lane, travel)) {
        ctx.globalAlpha = band.kind === 'PERFECT' ? 0.12 : 0.08;
        this.ribbon(band.top, band.bottom);
      }
      ctx.globalAlpha = 1;
      const target = project(field, lane, 1);
      ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(target.x - target.width / 2, target.y); ctx.lineTo(target.x + target.width / 2, target.y); ctx.stroke(); ctx.lineWidth = 1;
    }
    // Each moving guide is one musical beat across all lanes, in the same clock as notes.
    if (chart) for (const marker of beatsBetween(chart, judgeTime - WINDOWS.GOOD, judgeTime + travel)) {
      const p = progressAt(marker.time);
      const points = [-0.49, 0, 1, 2, 3, 4, 5, 5.49].map(lane => project(field, lane, p));
      ctx.strokeStyle = marker.beat % 4 === 0 ? '#ffffff28' : '#ffffff14';
      ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
      for (const segment of chordCurve(points)) {
        ctx.bezierCurveTo(segment.control1.x, segment.control1.y, segment.control2.x, segment.control2.y, segment.end.x, segment.end.y);
      }
      ctx.stroke();
    }
    const active = (note: ChartNote) => { const state = (note as PlayNote).state; return state === 'pending' || state === 'holding'; };
    // Connect actual heads only: a straight two-note link, or a smooth multi-note curve.
    for (const group of this.chords) {
      const headProgress = (note: ChartNote) => (note as PlayNote).state === 'holding' ? 1 : progressAt(note.time);
      const visible = group.filter(note => active(note) && headProgress(note) >= 0 && headProgress(note) <= 1 + WINDOWS.GOOD / travel + 1e-8)
        .sort((a, b) => a.lane - b.lane)
        .filter((note, i, notes) => i === 0 || note.lane !== notes[i - 1].lane);
      if (visible.length < 2) continue;
      ctx.strokeStyle = '#ffe779aa'; ctx.setLineDash([3, 3]); ctx.beginPath();
      const points = visible.map(note => project(field, note.lane, headProgress(note)));
      const start = points[0];
      ctx.moveTo(start.x, start.y);
      for (const segment of chordCurve(points)) {
        ctx.bezierCurveTo(segment.control1.x, segment.control1.y, segment.control2.x, segment.control2.y, segment.end.x, segment.end.y);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    for (const group of this.boxes) {
      const visible = group.filter(note => active(note) && progressAt(note.time) >= 0 && progressAt(note.time) <= 1);
      ctx.strokeStyle = '#ffffff66'; ctx.lineWidth = 2; ctx.setLineDash([4,4]); ctx.beginPath();
      visible.forEach((note, i) => { const point = project(field, note.lane, progressAt(note.time)); if (i) ctx.lineTo(point.x, point.y); else ctx.moveTo(point.x, point.y); });
      ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    }
    for (const note of notes) {
      if (!active(note)) continue;
      const p = note.state === 'holding' ? 1 : progressAt(note.time);
      if (p < 0 || p > 1 + WINDOWS.GOOD / travel + 1e-8) continue;
      const lane = note.state === 'holding' ? playLane(note) : note.lane;
      const head = project(field, lane, p), color = LANE_COLORS[lane];
      const gap = Math.min(60 / bpm / 4, this.gaps.get(note.id) ?? Infinity);
      const next = project(field, note.lane, p - gap / travel);
      const thickness = noteThickness(size, Math.abs(head.y - next.y), 8 * head.scale);
      if (note.gimmick === 'slide' && note.type === 'hold') {
        const remaining = note.state === 'holding' ? note.path!.slice(note.pathIndex ?? 0) : note.path!;
        const points = [{time:note.state === 'holding' ? judgeTime : note.time, lane}, ...remaining.map(point => ({...point, time:Math.max(point.time, note.state === 'holding' ? judgeTime + .001 : point.time)})), {time:Math.max(note.endTime, note.state === 'holding' ? judgeTime + .002 : note.endTime), lane:laneAt(note, note.endTime)}];
        for (let i = 1; i < points.length; i++) {
          const from = points[i - 1], to = points[i];
          const a = progressAt(from.time), b = progressAt(to.time);
          if (b > p || a < 0) continue;
          const near = Math.min(p, a), far = Math.max(0, b);
          const point = (progress: number) => project(field, from.lane + (to.lane - from.lane) * (a - progress) / (a - b), progress);
          const top = point(far), bottom = point(near);
          const gradient = ctx.createLinearGradient(top.x, top.y, bottom.x, bottom.y || top.y + 1);
          gradient.addColorStop(0, LANE_COLORS[to.lane] + 'b0'); gradient.addColorStop(1, LANE_COLORS[from.lane] + 'b0');
          ctx.fillStyle = gradient; this.ribbon(top, bottom, .22);
          ctx.strokeStyle = '#ffffff99'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(bottom.x, bottom.y); ctx.stroke(); ctx.lineWidth = 1;
          if (b >= 0 && b <= p) { ctx.fillStyle = LANE_COLORS[to.lane]; ctx.beginPath(); ctx.arc(top.x, top.y, 5 * top.scale, 0, Math.PI * 2); ctx.fill(); }
        }
      } else if (note.type === 'hold') {
        const rawTail = progressAt(note.endTime), tailP = Math.min(p, Math.max(0, rawTail));
        const segments = tailP < 1 && p > 1 ? [tailP, 1, p] : [tailP, p];
        ctx.fillStyle = `${color}${note.state === 'holding' ? '90' : '40'}`;
        for (let i = 1; i < segments.length; i++) this.ribbon(project(field, note.lane, segments[i - 1]), project(field, note.lane, segments[i]), 0.22);
        const tail = project(field, note.lane, tailP);
        ctx.strokeStyle = color; ctx.lineWidth = note.state === 'holding' ? 2 : 1;
        this.polygon([{ x: tail.x - tail.width * 0.22, y: tail.y }, { x: tail.x + tail.width * 0.22, y: tail.y },
          { x: head.x + head.width * 0.22, y: head.y }, { x: head.x - head.width * 0.22, y: head.y }], false); ctx.lineWidth = 1;
        if (rawTail >= 0) { ctx.fillStyle = color; ctx.fillRect(tail.x - tail.width / 2, tail.y - thickness / 2, tail.width, thickness); }
      }
      if (note.gimmick === 'dd') {
        const left = project(field, -.49, p), right = project(field, 5.49, p);
        const gradient = ctx.createLinearGradient(left.x, 0, right.x, 0);
        LANE_COLORS.forEach((color, i) => gradient.addColorStop(i / 5, color));
        ctx.fillStyle = gradient; ctx.fillRect(left.x, head.y - 6, right.x - left.x, 12);
        ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.fillText('DD · ANY', (left.x + right.x) / 2, head.y - 10); ctx.textAlign = 'start';
        continue;
      }
      if (note.gimmick === 'box' || note.gimmick === 'slide') {
        const group = this.boxes.find(group => group[0].boxId === note.boxId);
        const label = note.gimmick === 'box' ? `箱 ${group ? group.findIndex(member => member.id === note.id) + 1 : ''}/6` : '推し変 →';
        ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(label, head.x, head.y - Math.max(8, thickness)); ctx.textAlign = 'start';
      }
      ctx.shadowBlur = 3; ctx.shadowColor = color; ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(head.x - head.width / 2, head.y - thickness / 2, head.width, thickness, Math.min(3, thickness / 2)); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffffa0'; ctx.fillRect(head.x - head.width / 2 + 3, head.y - thickness / 2, Math.max(1, head.width - 6), 1);
      if (this.chordIds.has(note.id)) {
        const r = Math.max(2, Math.min(4, thickness / 2)); ctx.strokeStyle = '#fff'; ctx.fillStyle = '#10111c';
        this.polygon([{ x: head.x, y: head.y - r }, { x: head.x + r, y: head.y }, { x: head.x, y: head.y + r }, { x: head.x - r, y: head.y }]); ctx.stroke();
      }
    }
    if (playing) this.drawHoldEffects(notes, judgeTime);
    this.drawHitEffects(now);
  }
  private drawHoldEffects(notes: PlayNote[], time: number): void {
    const ctx = this.ctx, field = this.field, reduced = this.reducedMotion.matches;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const note of notes) {
      if (note.state !== 'holding' || !this.pressed.has(playLane(note))) continue;
      const target = field.targets[playLane(note)], color = LANE_COLORS[playLane(note)];
      const elapsed = Math.max(0, time - note.time);
      ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.globalAlpha = reduced ? 0.2 : 0.2 + Math.sin(elapsed * 8) * 0.04;
      ctx.beginPath(); ctx.ellipse(target.x, target.y, target.width * 0.36, target.height * 0.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.65; ctx.stroke();
      if (reduced) continue;
      // Fixed-size streams use the song clock: no particle accumulation or frame-rate dependence.
      for (let i = 0; i < 12; i++) {
        const p = (elapsed * 1000 + i * 73) % 640 / 640;
        const angle = -Math.PI * (0.18 + (i % 5) * 0.16);
        const distance = p * (28 + (i % 4) * 9);
        const originX = target.x + (i % 3 - 1) * target.width * 0.12;
        const x = Math.max(3, Math.min(field.width - 3, originX + Math.cos(angle) * distance));
        const y = target.y + Math.sin(angle) * distance - p * 10 + p * p * 12;
        const length = 2 + (1 - p) * 3;
        ctx.globalAlpha = (1 - p) * 0.9;
        ctx.strokeStyle = i % 3 === 0 ? '#ffffff' : color;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length); ctx.stroke();
      }
    }
    ctx.restore();
  }
  private drawHitEffects(now: number): void {
    const ctx = this.ctx, field = this.field, reduced = this.reducedMotion.matches;
    const duration = reduced ? 160 : 420;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [lane, flash] of this.flashes) {
      const age = now - flash.time;
      if (age >= duration) { this.flashes.delete(lane); continue; }
      if (age < 0) continue;
      const target = field.targets[lane], color = LANE_COLORS[lane];
      const strength = flash.kind === 'PERFECT' ? 1 : flash.kind === 'GREAT' ? 0.8 : 0.6;
      const p = age / duration, fade = (1 - p) ** 2 * strength;
      const spread = reduced ? 0 : 1 - (1 - p) ** 3;
      ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.globalAlpha = fade * 0.38;
      ctx.fillRect(target.x - target.width / 2, target.y - target.height / 2, target.width, target.height);
      ctx.globalAlpha = fade;
      const radiusX = Math.min(target.width * (0.3 + spread * 0.48), target.x - 2, field.width - target.x - 2);
      const radiusY = target.height * (0.17 + spread * 0.28);
      ctx.beginPath(); ctx.ellipse(target.x, target.y, radiusX, radiusY, 0, 0, Math.PI * 2); ctx.stroke();
      if (reduced) continue;
      // Sparks fan upwards from the receptor, keeping the approaching notes readable.
      for (let i = 0; i < 7; i++) {
        const angle = -Math.PI * (0.12 + i * 0.76 / 6);
        const distance = target.width * 0.18 + spread * (24 + (i % 3) * 9);
        const x = Math.max(3, Math.min(field.width - 3, target.x + Math.cos(angle) * distance));
        const y = target.y + Math.sin(angle) * distance - spread * 8;
        const length = (3 + (i % 2) * 2) * (1 - p);
        ctx.strokeStyle = i % 2 ? '#ffffff' : color;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length); ctx.stroke();
      }
    }
    ctx.restore();
  }
  destroy(): void { this.observer.disconnect(); }
}
