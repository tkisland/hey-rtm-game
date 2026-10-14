import type { Chart, TapNote } from './chart';
import { LANE_COLORS } from './colors';
import { MAX_TIME, quantizeTime } from './editor-model';
import type { Division } from './editor-model';

const LEFT = 42, TOP = 30;
export interface TimelineState { chart: Chart; selected: number | null; start: number; span: number; division: Division; snap: boolean; time: number }
export class Timeline {
  private ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private drag: { pointer: number; id: number; x: number; y: number; moved: boolean; preview: TapNote } | null = null;
  private state!: TimelineState;
  private listeners = new AbortController();
  private observer: ResizeObserver;
  get dragging(): boolean { return this.drag !== null; }
  constructor(private canvas: HTMLCanvasElement, callbacks: { select(id: number | null): void; move(id: number, time: number, lane: number): void; seek(time: number): void }) {
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvasを使用できません。');
    this.ctx = context;
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas);
    this.resize();
    const signal = this.listeners.signal;
    canvas.addEventListener('pointerdown', event => {
      if (!this.state || this.drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault();
      if (event.pointerType === 'mouse') canvas.focus({ preventScroll: true });
      const { x, y } = this.position(event);
      if (y < TOP && x >= LEFT) { callbacks.seek(this.timeAt(x)); return; }
      const lane = this.laneAt(y);
      const matches = this.state.chart.notes.filter(note => note.lane === lane && note.time >= this.state.start && note.time <= this.state.start + this.state.span && Math.abs(this.xAt(note.time) - x) <= 10);
      const note = matches.sort((a, b) => Math.abs(this.xAt(a.time) - x) - Math.abs(this.xAt(b.time) - x))[0];
      callbacks.select(note?.id ?? null);
      if (note) {
        this.drag = { pointer: event.pointerId, id: note.id, x, y, moved: false, preview: { ...note } };
        canvas.setPointerCapture(event.pointerId);
      }
    }, { signal });
    canvas.addEventListener('pointermove', event => {
      const drag = this.drag; if (!drag || drag.pointer !== event.pointerId) return;
      const { x, y } = this.position(event);
      if (Math.hypot(x - drag.x, y - drag.y) < 3 && !drag.moved) return;
      drag.moved = true;
      const original = this.state.chart.notes.find(note => note.id === drag.id); if (!original) return;
      const time = Math.min(MAX_TIME, Math.max(0, original.time + (x - drag.x) / (this.width - LEFT) * this.state.span));
      drag.preview.time = this.state.snap ? quantizeTime(time, this.state.chart.bpm, this.state.chart.beatOrigin ?? 0, this.state.division) : Math.round(time * 1000) / 1000;
      drag.preview.lane = this.laneAt(y);
    }, { signal });
    canvas.addEventListener('pointerup', event => {
      const drag = this.drag; if (!drag || drag.pointer !== event.pointerId) return;
      this.drag = null;
      if (drag.moved) callbacks.move(drag.id, drag.preview.time, drag.preview.lane);
    }, { signal });
    const cancel = () => { this.drag = null; };
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
  private laneAt(y: number): number { return Math.max(0, Math.min(5, Math.floor((y - TOP) / ((this.height - TOP) / 6)))); }
  draw(state: TimelineState): void {
    this.state = state;
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
      ctx.strokeStyle = beat ? '#ffffff36' : '#ffffff12'; ctx.beginPath(); ctx.moveTo(x, TOP); ctx.lineTo(x, this.height); ctx.stroke();
    }
    const labelStep = state.span <= 4 ? 0.5 : state.span <= 16 ? 2 : 4;
    for (let time = Math.ceil(state.start / labelStep) * labelStep; time <= state.start + state.span; time += labelStep) {
      ctx.fillStyle = '#aaaac1'; ctx.fillText(`${time.toFixed(1)}s`, this.xAt(time) + 3, 19);
    }
    const drawNote = (note: TapNote, ghost = false) => {
      const x = this.xAt(ghost ? note.sourceTime! : note.time), y = TOP + (note.lane + 0.5) * row;
      if (x < LEFT - 8 || x > this.width + 8) return;
      ctx.strokeStyle = ghost ? `${LANE_COLORS[note.lane]}60` : note.id === state.selected ? '#fff' : LANE_COLORS[note.lane];
      ctx.fillStyle = LANE_COLORS[note.lane]; ctx.lineWidth = note.id === state.selected && !ghost ? 3 : 1;
      if (!ghost) ctx.fillRect(x - 5, y - 10, 10, 20);
      ctx.strokeRect(x - 6, y - 11, 12, 22); ctx.lineWidth = 1;
    };
    state.chart.notes.forEach(note => { if (note.sourceTime !== undefined && Math.abs(note.sourceTime - note.time) > 0.001) drawNote(note, true); });
    state.chart.notes.forEach(note => { if (note.id !== this.drag?.id) drawNote(note); });
    if (this.drag) drawNote(this.drag.preview);
    const playhead = this.xAt(state.time);
    ctx.strokeStyle = '#ff96b5'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(playhead, 0); ctx.lineTo(playhead, this.height); ctx.stroke(); ctx.lineWidth = 1;
    ctx.restore();
  }
  destroy(): void { this.listeners.abort(); this.observer.disconnect(); }
}
