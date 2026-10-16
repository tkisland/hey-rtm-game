import type { PlayNote } from './engine';
import { BOX_SWEEP_SECONDS, BOX_WINDOWS, WINDOWS, playLane } from './engine';
import { laneAt } from './chart';
import { slideRoute } from './slide-route';
import { responseMark } from './response-art';
import { drawStage } from './stage-art';
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
  private boxTrail: { lane: number; time: number; step: number; id: number; complete: boolean }[] = [];
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  pressed = new Set<number>();
  private cachedNotes: PlayNote[] | null = null;
  private renderNotes: PlayNote[] = [];
  private chords: ChartNote[][] = [];
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
  flashBox(lane: number, now: number, step: number, id: number, complete = false): void {
    const previous = this.boxTrail.at(-1);
    if (!previous || previous.id !== id || previous.step + 1 !== step) this.boxTrail = [];
    this.boxTrail.push({lane, time:now, step, id, complete});
    if (this.boxTrail.length > 6) this.boxTrail.shift();
  }
  completeBox(now: number, id: number, direction = 1): void {
    for (let step = 0; step < 6; step++) {
      const lane = direction === -1 ? 5 - step : step;
      this.flash(lane, now); this.flashBox(lane, now - (5 - step) * 14, step + 1, id, step === 5);
    }
  }
  clearEffects(): void { this.flashes.clear(); this.boxTrail = []; }
  private polygon(points: { x: number; y: number }[], fill = true): void {
    const ctx = this.ctx; ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach(point => ctx.lineTo(point.x, point.y)); ctx.closePath();
    if (fill) ctx.fill(); else ctx.stroke();
  }
  private ribbon(top: FieldPoint, bottom: FieldPoint, factor = 0.5): void {
    this.polygon([{ x: top.x - top.width * factor, y: top.y }, { x: top.x + top.width * factor, y: top.y },
      { x: bottom.x + bottom.width * factor, y: bottom.y }, { x: bottom.x - bottom.width * factor, y: bottom.y }]);
  }
  private releaseCap(point: FieldPoint, thickness: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color; ctx.fillRect(point.x - point.width / 2, point.y - thickness / 2, point.width, thickness);
    ctx.strokeStyle = '#111321bb'; ctx.lineWidth = Math.max(.7, thickness / 9);
    for (const offset of [-.23, .23]) {
      ctx.beginPath(); ctx.moveTo(point.x - point.width * .37, point.y + thickness * offset);
      ctx.lineTo(point.x + point.width * .37, point.y + thickness * offset); ctx.stroke();
    }
    ctx.lineWidth = 1;
  }
  private drawSlide(note: PlayNote, progressAt: (time: number) => number, p: number, thickness: number, travel: number): void {
    const ctx = this.ctx, field = this.field, route = slideRoute(note);
    // The route is fixed in song time. Gripping early/late cannot bend or reshape the future band.
    for (let i = 1; i < route.length; i++) {
      const from = route[i - 1], to = route[i];
      if (from.time === to.time) {
        const q = progressAt(to.time);
        if (q < 0 || q > 1 + WINDOWS.GOOD / travel) continue;
        const start = project(field, from.lane, q), end = project(field, to.lane, q);
        const gradient = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
        gradient.addColorStop(0, LANE_COLORS[from.lane]); gradient.addColorStop(1, LANE_COLORS[to.lane]);
        ctx.strokeStyle = gradient; ctx.lineWidth = Math.max(2, 4 * end.scale); ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
        const direction = Math.sign(to.lane - from.lane), r = 6 * end.scale;
        ctx.fillStyle = LANE_COLORS[to.lane];
        this.polygon([{x:end.x, y:end.y}, {x:end.x - direction * r, y:end.y - r}, {x:end.x - direction * r, y:end.y + r}]);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(start.x, start.y, 3 * start.scale, 0, Math.PI * 2); ctx.stroke();
      } else {
        const near = Math.min(p, progressAt(from.time)), far = Math.max(0, progressAt(to.time));
        if (far > near) continue;
        ctx.fillStyle = LANE_COLORS[from.lane] + (note.state === 'holding' ? '85' : '48');
        this.ribbon(project(field, from.lane, far), project(field, from.lane, near), .22);
      }
    }
    if (note.type === 'hold') {
      const tailP = progressAt(note.endTime);
      if (tailP >= 0 && tailP <= 1 + WINDOWS.GOOD / travel) this.releaseCap(project(field, laneAt(note, note.endTime), tailP), thickness, LANE_COLORS[laneAt(note, note.endTime)]);
    }
    ctx.lineWidth = 1;
  }
  draw(notes: PlayNote[], time: number, travel: number, now: number, size = 100, bpm = 140, inputOffsetMs = 0, playing = true, chart?: Chart): void {
    if (this.canvas.width !== Math.round(this.field.width * (window.devicePixelRatio || 1))) this.resize();
    const ctx = this.ctx, field = this.field, w = field.width, h = field.height;
    // Match the input clock so every compensated PERFECT arrives at a fixed button.
    const judgeTime = time - inputOffsetMs / 1000;
    const progressAt = (seconds: number) => 1 + (judgeTime - seconds) / travel;
    if (this.cachedNotes !== notes) {
      this.cachedNotes = notes; this.chords = chordGroups(notes); this.gaps.clear();
      // A wide DD must never hide the color of a simultaneous ordinary note.
      this.renderNotes = [...notes].sort((a, b) => Number(b.gimmick === 'dd' || b.gimmick === 'box') - Number(a.gimmick === 'dd' || a.gimmick === 'box'));
      for (let lane = 0; lane < 6; lane++) {
        const ordered = notes.filter(note => note.lane === lane && note.gimmick !== 'box').sort((a, b) => a.time - b.time);
        ordered.forEach((note, i) => this.gaps.set(note.id, Math.min(note.time - (ordered[i - 1]?.time ?? -Infinity), (ordered[i + 1]?.time ?? Infinity) - note.time)));
      }
    }
    const backdrop = ctx.createLinearGradient(0, 0, 0, h); backdrop.addColorStop(0, '#21172f'); backdrop.addColorStop(1, '#0b1020');
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = backdrop; ctx.fillRect(0, 0, w, h);
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
      ctx.fillStyle = lane % 2 ? '#1c2034d9' : '#171b2ed9'; this.polygon(edges);
      ctx.strokeStyle = '#ffffff12'; ctx.lineWidth = 1; this.polygon(edges, false);
      const age = now - (this.flashes.get(lane)?.time ?? -1000);
      const alpha = this.pressed.has(lane) ? 0.10 : Math.max(0, 1 - age / 220) * 0.20;
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
    const responses = Array.from({length:6}, () => 0);
    for (const note of notes) if (note.state === 'pending') {
      const p = progressAt(note.time);
      if (p >= 0 && p < .16) {
        const pulse = this.reducedMotion.matches ? .5 : 1 - p / .16;
        if (note.gimmick === 'dd' || note.gimmick === 'box') responses.forEach((level, lane) => { responses[lane] = Math.max(level, pulse); });
        else responses[note.lane] = Math.max(responses[note.lane], pulse);
      }
    }
    drawStage(ctx, field, responses);
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
    for (const note of this.renderNotes) {
      if (!active(note)) continue;
      const raw = progressAt(note.time), box = note.gimmick === 'box';
      if (box && raw > 1 + (BOX_WINDOWS.GOOD + BOX_SWEEP_SECONDS) / travel) continue;
      const p = note.state === 'holding' || box && (note.boxProgress || raw >= 1) ? 1 : raw;
      if (p < 0 || p > 1 + WINDOWS.GOOD / travel + 1e-8) continue;
      const lane = note.state === 'holding' ? playLane(note) : note.lane;
      const head = project(field, lane, p), color = LANE_COLORS[lane];
      const gap = Math.min(60 / bpm / 2, this.gaps.get(note.id) ?? Infinity);
      const next = project(field, note.lane, p - gap / travel);
      const thickness = noteThickness(size, Math.abs(head.y - next.y), 10 * head.scale);
      if (box) {
        const left = project(field, -.49, p).x, right = project(field, 5.49, p).x, height = Math.max(14, 12 * size / 100);
        const gradient = ctx.createLinearGradient(left, 0, right, 0);
        LANE_COLORS.forEach((color, i) => gradient.addColorStop(i / 5, color));
        ctx.fillStyle = gradient; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(left, head.y - height / 2, right - left, height, height / 2); ctx.fill(); ctx.stroke();
        for (let lane = 0; lane < 6; lane++) {
          const point = project(field, lane, p), progress = note.boxProgress ?? 0;
          const visited = note.boxDirection === -1 ? lane >= 6 - progress : lane < progress;
          ctx.fillStyle = visited ? '#fff' : '#21182d'; ctx.strokeStyle = '#21182d'; ctx.lineWidth = .7;
          responseMark(ctx, point.x, head.y, height * .3, true); ctx.stroke();
        }
        ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        ctx.fillText(`← 箱推し SWIPE →${note.boxProgress ? ` ${note.boxProgress}/6` : ''}`, field.width / 2, head.y - height / 2 - 5);
        ctx.textAlign = 'start'; ctx.lineWidth = 1; continue;
      }
      if (note.gimmick === 'slide' && note.type === 'hold') {
        this.drawSlide(note, progressAt, p, thickness, travel);
      } else if (note.type === 'hold') {
        const rawTail = progressAt(note.endTime), tailP = Math.min(p, Math.max(0, rawTail));
        const segments = tailP < 1 && p > 1 ? [tailP, 1, p] : [tailP, p];
        ctx.fillStyle = `${color}${note.state === 'holding' ? '90' : '40'}`;
        for (let i = 1; i < segments.length; i++) this.ribbon(project(field, note.lane, segments[i - 1]), project(field, note.lane, segments[i]), 0.22);
        const tail = project(field, note.lane, tailP);
        ctx.strokeStyle = color; ctx.lineWidth = note.state === 'holding' ? 2 : 1;
        this.polygon([{ x: tail.x - tail.width * 0.22, y: tail.y }, { x: tail.x + tail.width * 0.22, y: tail.y },
          { x: head.x + head.width * 0.22, y: head.y }, { x: head.x - head.width * 0.22, y: head.y }], false); ctx.lineWidth = 1;
        if (rawTail >= 0) this.releaseCap(tail, thickness, color);
      }
      if (note.gimmick === 'dd') {
        const center = project(field, 2.5, p), width = project(field, 5.49, p).x - project(field, -.49, p).x, height = Math.max(12, thickness);
        const left = center.x - width / 2, top = center.y - height / 2;
        const gradient = ctx.createLinearGradient(left, 0, left + width, 0);
        LANE_COLORS.forEach((color, i) => gradient.addColorStop(i / 5, color));
        ctx.save();
        // A steady halo keeps DD luminous without flashing or changing its hit area.
        ctx.shadowColor = '#d8baff'; ctx.shadowBlur = 14;
        ctx.fillStyle = gradient; ctx.beginPath(); ctx.roundRect(left, top, width, height, height / 2); ctx.fill();
        ctx.shadowBlur = 0;
        const sheen = ctx.createLinearGradient(0, top, 0, top + height);
        sheen.addColorStop(0, '#ffffffb3'); sheen.addColorStop(.35, '#ffffff33');
        sheen.addColorStop(.55, '#38245f55'); sheen.addColorStop(1, '#ffffff66');
        ctx.fillStyle = sheen; ctx.fill();
        ctx.strokeStyle = '#fffffff0'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#fff';
        for (const x of [left + width * .16, left + width * .84]) {
          const r = Math.min(4, height * .3);
          this.polygon([{x, y:top - r}, {x:x + r * .4, y:top}, {x, y:top + r}, {x:x - r * .4, y:top}]);
        }
        ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        // A violet keyline preserves white lettering over the white/yellow lanes.
        ctx.strokeStyle = '#593b83'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
        ctx.strokeText('DD', center.x, center.y); ctx.fillText('DD', center.x, center.y);
        ctx.restore();
        continue;
      }
      if (note.gimmick === 'slide' && note.state !== 'holding') {
        const nextLane = note.path?.[0]?.lane;
        const label = nextLane === undefined ? '終点で離す' : nextLane < lane ? '推し変 ←' : '推し変 →';
        ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(label, head.x, head.y - Math.max(8, thickness)); ctx.textAlign = 'start';
      }
      ctx.shadowBlur = 3; ctx.shadowColor = color; ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(head.x - head.width / 2, head.y - thickness / 2, head.width, thickness, thickness / 2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffff80'; ctx.lineWidth = .7; ctx.stroke(); ctx.lineWidth = 1;
      if (thickness >= 5) {
        ctx.fillStyle = lane === 2 ? '#28203f' : '#fff'; responseMark(ctx, head.x, head.y, thickness * .43, note.gimmick === 'box');
      }
      ctx.fillStyle = '#ffffffa0'; ctx.fillRect(head.x - head.width / 2 + 3, head.y - thickness / 2, Math.max(1, head.width - 6), 1);
      // Small light motes follow the response from the stage; holds keep their distinct bands.
      if (!this.reducedMotion.matches && note.state === 'pending' && p <= 1) {
        ctx.save(); ctx.fillStyle = color;
        for (let i = 1; i <= 3; i++) {
          const y = head.y - thickness / 2 - i * 5;
          if (y <= field.origin + 2) continue;
          ctx.globalAlpha = .45 / i;
          ctx.beginPath(); ctx.arc(head.x + (i % 2 ? -1 : 1) * 3, y, 1.5 / Math.sqrt(i), 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    }
    if (playing) this.drawHoldEffects(notes, judgeTime);
    this.drawHitEffects(now);
    this.drawBoxEffects(now);
  }
  private drawBoxEffects(now: number): void {
    const ctx = this.ctx, field = this.field, reduced = this.reducedMotion.matches;
    const duration = reduced ? 160 : 1100;
    this.boxTrail = this.boxTrail.filter(hit => now - hit.time < duration && now >= hit.time);
    if (!this.boxTrail.length) return;
    ctx.save();
    for (let i = 0; i < this.boxTrail.length; i++) {
      const hit = this.boxTrail[i], target = field.targets[hit.lane];
      const p = (now - hit.time) / duration, color = LANE_COLORS[hit.lane];
      ctx.globalAlpha = (1 - p) * .9; ctx.fillStyle = color; ctx.strokeStyle = color;
      const y = target.y - 18 - (reduced ? 0 : p * 16);
      if (!reduced && i > 0) {
        const previous = this.boxTrail[i - 1], from = field.targets[previous.lane];
        const gradient = ctx.createLinearGradient(from.x, y, target.x, y);
        gradient.addColorStop(0, LANE_COLORS[previous.lane]); gradient.addColorStop(1, color);
        ctx.strokeStyle = gradient; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(from.x, y); ctx.quadraticCurveTo((from.x + target.x) / 2, y - 12, target.x, y); ctx.stroke();
      }
      responseMark(ctx, target.x, y, reduced ? 4 : 4 + (1 - p) * 3, true);
    }
    const last = this.boxTrail.at(-1)!;
    if (last.complete) {
      ctx.globalAlpha = Math.max(0, 1 - (now - last.time) / duration);
      const gradient = ctx.createLinearGradient(0, 0, field.width, 0);
      LANE_COLORS.forEach((color, i) => gradient.addColorStop(i / 5, color));
      ctx.strokeStyle = gradient; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(field.targets[0].x, field.near - 9);
      ctx.quadraticCurveTo(field.width / 2, field.near - (reduced ? 9 : 36), field.targets[5].x, field.near - 9); ctx.stroke();
    }
    ctx.restore();
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
        if (i === 2 || i === 4) { ctx.fillStyle = color; responseMark(ctx, x, y, (2 + strength) * (1 - p)); }
        const length = (3 + (i % 2) * 2) * (1 - p);
        ctx.strokeStyle = i % 2 ? '#ffffff' : color;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length); ctx.stroke();
      }
    }
    ctx.restore();
  }
  destroy(): void { this.observer.disconnect(); }
}
