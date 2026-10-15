import type { Chart, ChartNote } from './chart';
import { LANE_COLORS } from './colors';
import { chordGroups, noteThickness } from './note-display';
import { inRange, MAX_TIME, MIN_HOLD, quantizeTime } from './editor-model';
import type { Division, TimeRange } from './editor-model';

const LEFT = 42, TOP = 30;
export interface TimelineState { chart: Chart; selected: number | null; range: TimeRange | null; rangeMode: boolean; noteSize: number; start: number; span: number; division: Division; snap: boolean; time: number }
export class Timeline {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private drag: { pointer: number; id: number; x: number; y: number; moved: boolean; mode: 'move' | 'end'; preview: ChartNote } | null = null;
  private rangeDrag: { pointer: number; start: number; end: number } | null = null;
  private state!: TimelineState;
  private cachedChart: Chart | null = null;
  private chords: ChartNote[][] = [];
  private chordIds = new Set<number>();
  private gaps = new Map<number, number>();
  private listeners = new AbortController();
  private observer: ResizeObserver;
  get dragging(): boolean { return this.drag !== null || this.rangeDrag !== null; }
  constructor(private canvas: HTMLCanvasElement, callbacks: { select(id: number | null): void; range(range: TimeRange): void; move(id: number, time: number, lane: number): void; resize(id: number, endTime: number): void; seek(time: number): void }) {
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvasを使用できません。');
    this.ctx = context;
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas);
    this.resize();
    const signal = this.listeners.signal;
    canvas.addEventListener('pointerdown', event => {
      if (!this.state || this.dragging || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      if (event.pointerType === 'mouse') canvas.focus({ preventScroll: true });
      const { x, y } = this.position(event);
      if (y < TOP && x >= LEFT) { callbacks.seek(this.timeAt(x)); return; }
      if (this.state.rangeMode || event.shiftKey) {
        if (x < LEFT) return;
        const time = this.rangeTime(x);
        this.rangeDrag = { pointer: event.pointerId, start: time, end: time };
        canvas.setPointerCapture(event.pointerId); return;
      }
      const lane = this.laneAt(y);
      const distance = (note: ChartNote) => Math.min(Math.abs(this.xAt(note.time) - x), note.type === 'hold' ? Math.abs(this.xAt(note.endTime) - x) : Infinity);
      const matches = this.state.chart.notes.filter(note => note.lane === lane && (distance(note) <= 10 || (note.type === 'hold' && x >= this.xAt(note.time) && x <= this.xAt(note.endTime))));
      const note = matches.sort((a, b) => distance(a) - distance(b))[0];
      callbacks.select(note?.id ?? null);
      if (note) {
        this.drag = { pointer: event.pointerId, id: note.id, x, y, moved: false, mode: note.type === 'hold' && Math.abs(this.xAt(note.endTime) - x) <= 10 && Math.abs(this.xAt(note.endTime) - x) < Math.abs(this.xAt(note.time) - x) ? 'end' : 'move', preview: { ...note } };
        canvas.setPointerCapture(event.pointerId);
      }
    }, { signal });
    canvas.addEventListener('pointermove', event => {
      if (this.rangeDrag?.pointer === event.pointerId) { this.rangeDrag.end = this.rangeTime(this.position(event).x); return; }
      const drag = this.drag; if (!drag || drag.pointer !== event.pointerId) return;
      const { x, y } = this.position(event);
      if (Math.hypot(x - drag.x, y - drag.y) < 3 && !drag.moved) return;
      drag.moved = true;
      const original = this.state.chart.notes.find(note => note.id === drag.id); if (!original) return;
      if (drag.mode === 'end' && original.type === 'hold' && drag.preview.type === 'hold') {
        const value = original.endTime + (x - drag.x) / (this.width - LEFT) * this.state.span;
        const snapped = this.state.snap ? quantizeTime(value, this.state.chart.bpm, this.state.chart.beatOrigin ?? 0, this.state.division) : Math.round(value * 1000) / 1000;
        drag.preview.endTime = Math.max(original.time + MIN_HOLD, Math.min(MAX_TIME, snapped)); return;
      }
      const time = Math.min(MAX_TIME, Math.max(0, original.time + (x - drag.x) / (this.width - LEFT) * this.state.span));
      drag.preview.time = this.state.snap ? quantizeTime(time, this.state.chart.bpm, this.state.chart.beatOrigin ?? 0, this.state.division) : Math.round(time * 1000) / 1000;
      if (drag.preview.type === 'hold' && original.type === 'hold') {
        drag.preview.time = Math.min(MAX_TIME - (original.endTime - original.time), drag.preview.time);
        drag.preview.endTime = original.endTime + drag.preview.time - original.time;
      }
      drag.preview.lane = this.laneAt(y);
    }, { signal });
    canvas.addEventListener('pointerup', event => {
      if (this.rangeDrag?.pointer === event.pointerId) {
        const { start } = this.rangeDrag, end = this.rangeTime(this.position(event).x); this.rangeDrag = null;
        if (start !== end) callbacks.range({ start: Math.min(start, end), end: Math.max(start, end) });
        return;
      }
      const drag = this.drag; if (!drag || drag.pointer !== event.pointerId) return;
      this.drag = null;
      if (drag.moved) {
        if (drag.mode === 'end' && drag.preview.type === 'hold') callbacks.resize(drag.id, drag.preview.endTime);
        else callbacks.move(drag.id, drag.preview.time, drag.preview.lane);
      }
    }, { signal });
    const cancel = () => { this.drag = null; this.rangeDrag = null; };
    canvas.addEventListener('pointercancel', cancel, { signal });
    canvas.addEventListener('lostpointercapture', cancel, { signal });
  }
  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width; this.height = rect.height;
    this.canvas.width = Math.round(this.width * devicePixelRatio); this.canvas.height = Math.round(this.height * devicePixelRatio);
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  private position(event: PointerEvent): { x: number; y: number } { const rect = this.canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  private xAt(time: number): number { return LEFT + (time - this.state.start) / this.state.span * (this.width - LEFT); }
  private timeAt(x: number): number { return Math.min(MAX_TIME, Math.max(0, this.state.start + (x - LEFT) / (this.width - LEFT) * this.state.span)); }
  private rangeTime(x: number): number {
    const time = this.timeAt(x);
    return this.state.snap ? quantizeTime(time, this.state.chart.bpm, this.state.chart.beatOrigin ?? 0, this.state.division) : Math.round(time * 1000) / 1000;
  }
  private laneAt(y: number): number { return Math.max(0, Math.min(5, Math.floor((y - TOP) / ((this.height - TOP) / 6)))); }
  draw(state: TimelineState): void {
    this.state = state;
    if (this.cachedChart !== state.chart) {
      this.cachedChart = state.chart; this.chords = chordGroups(state.chart.notes); this.chordIds = new Set(this.chords.flat().map(note => note.id)); this.gaps.clear();
      for (let lane = 0; lane < 6; lane++) {
        const notes = state.chart.notes.filter(note => note.lane === lane);
        notes.forEach((note, i) => this.gaps.set(note.id, Math.min(note.time - (notes[i - 1]?.time ?? -Infinity), (notes[i + 1]?.time ?? Infinity) - note.time)));
      }
    }
    const ctx = this.ctx, row = (this.height - TOP) / 6;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#10111c'; ctx.fillRect(0, 0, this.width, this.height);
    ctx.font = '11px sans-serif';
    for (let lane = 0; lane < 6; lane++) {
      ctx.fillStyle = `${LANE_COLORS[lane]}0c`; ctx.fillRect(LEFT, TOP + lane * row, this.width - LEFT, row - 1);
      ctx.fillStyle = LANE_COLORS[lane]; ctx.fillText(`${lane + 1} ${'SDFJKL'[lane]}`, 6, TOP + (lane + 0.5) * row + 4);
    }
    const step = 60 / state.chart.bpm / state.division, origin = state.chart.beatOrigin ?? 0;
    const first = Math.ceil((state.start - origin) / step);
    ctx.save(); ctx.beginPath(); ctx.rect(LEFT, 0, this.width - LEFT, this.height); ctx.clip();
    for (let i = first; ; i++) {
      const time = origin + i * step; if (time > state.start + state.span) break;
      const x = this.xAt(time), beat = i % state.division === 0;
      ctx.strokeStyle = beat ? '#bda7f788' : i % 2 === 0 ? '#ffffff35' : '#ffffff15'; ctx.beginPath(); ctx.moveTo(x, TOP); ctx.lineTo(x, this.height); ctx.stroke();
    }
    const labelStep = state.span <= 4 ? 0.5 : state.span <= 16 ? 2 : 4;
    for (let time = Math.ceil(state.start / labelStep) * labelStep; time <= state.start + state.span; time += labelStep) {
      ctx.fillStyle = '#aaaac1'; ctx.fillText(`${time.toFixed(1)}s`, this.xAt(time) + 3, 19);
    }
    const range = this.rangeDrag ? { start: Math.min(this.rangeDrag.start, this.rangeDrag.end), end: Math.max(this.rangeDrag.start, this.rangeDrag.end) } : state.range;
    if (range) {
      const left = this.xAt(range.start), width = this.xAt(range.end) - left;
      ctx.fillStyle = '#bda7f72b'; ctx.fillRect(left, TOP, width, this.height - TOP);
      ctx.strokeStyle = '#cbb9ff'; ctx.strokeRect(left, TOP, width, this.height - TOP);
    }
    for (const group of this.chords) {
      const x = this.xAt(group[0].time);
      ctx.strokeStyle = '#ffe77999'; ctx.setLineDash([3, 3]); ctx.beginPath();
      ctx.moveTo(x, TOP + (Math.min(...group.map(note => note.lane)) + 0.5) * row); ctx.lineTo(x, TOP + (Math.max(...group.map(note => note.lane)) + 0.5) * row); ctx.stroke(); ctx.setLineDash([]);
    }
    const drawNote = (note: ChartNote, ghost = false) => {
      const start = ghost ? note.sourceTime! : note.time;
      const end = note.type === 'hold' ? ghost ? note.sourceEndTime ?? note.endTime : note.endTime : start;
      const x = this.xAt(start), endX = this.xAt(end), y = TOP + (note.lane + 0.5) * row;
      if (endX < LEFT - 8 || x > this.width + 8) return;
      const spacing = Math.min(step, this.gaps.get(note.id) ?? Infinity) / state.span * (this.width - LEFT);
      const width = noteThickness(state.noteSize, spacing, 12), color = LANE_COLORS[note.lane];
      const selected = note.id === state.selected || Boolean(range && inRange(note, range));
      ctx.strokeStyle = ghost ? `${color}60` : selected ? '#fff' : color;
      ctx.fillStyle = color; ctx.lineWidth = selected && !ghost ? 2 : 1;
      if (note.type === 'hold') {
        const left = Math.max(LEFT - 8, x), right = Math.min(this.width + 8, endX);
        if (!ghost) { ctx.fillStyle = `${color}40`; ctx.fillRect(left, y - 7, right - left, 14); }
        ctx.strokeRect(left, y - 7, right - left, 14); ctx.fillStyle = color;
        if (!ghost) ctx.fillRect(endX - width / 2, y - 11, width, 22);
      }
      if (!ghost) ctx.fillRect(x - width / 2, y - 11, width, 22);
      ctx.strokeRect(x - width / 2, y - 11, width, 22); ctx.lineWidth = 1;
      if (!ghost && this.chordIds.has(note.id)) {
        ctx.strokeStyle = '#fff'; ctx.fillStyle = '#10111c'; const r = Math.max(2, Math.min(3, width / 2)); ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    };
    state.chart.notes.forEach(note => { if (note.sourceTime !== undefined && (Math.abs(note.sourceTime - note.time) > 0.001 || (note.type === 'hold' && note.sourceEndTime !== undefined && Math.abs(note.sourceEndTime - note.endTime) > 0.001))) drawNote(note, true); });
    state.chart.notes.forEach(note => { if (note.id !== this.drag?.id) drawNote(note); });
    if (this.drag) drawNote(this.drag.preview);
    const playhead = this.xAt(state.time);
    ctx.strokeStyle = '#ff96b5'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(playhead, 0); ctx.lineTo(playhead, this.height); ctx.stroke(); ctx.lineWidth = 1;
    ctx.restore();
  }
  destroy(): void { this.listeners.abort(); this.observer.disconnect(); }
}
