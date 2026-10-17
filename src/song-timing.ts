import type { Chart } from './chart';

/** Automatic reference sounds follow the judgement clock, independently of visual position. */
export class SongSoundTimeline {
  private events: {time:number;lane:number}[];
  private previous: number | null = null;
  private cursor = 0;
  constructor(chart: Chart) {
    this.events = chart.notes.flatMap(note => [
      {time:note.time,lane:note.gimmick==='dd'?2:note.lane},
      ...(note.type === 'hold' ? [{time:note.endTime,lane:note.gimmick === 'slide' ? note.path?.at(-1)?.lane ?? note.lane : note.lane}] : []),
    ]).sort((a,b) => a.time-b.time);
  }
  reset(): void { this.previous = null; }
  advance(time: number, playing: boolean, discontinuity = false): number[] {
    if (!Number.isFinite(time) || !playing) { this.reset(); return []; }
    if (this.previous === null || discontinuity || time < this.previous || time-this.previous > .5) {
      this.cursor = this.events.findIndex(event => event.time >= time);
      if (this.cursor < 0) this.cursor = this.events.length;
      this.previous = time; return [];
    }
    const lanes = new Set<number>();
    while (this.cursor < this.events.length && this.events[this.cursor].time <= time) {
      const event = this.events[this.cursor++];
      if (time-event.time <= .08) lanes.add(event.lane);
    }
    this.previous = time;
    return [...lanes];
  }
}
