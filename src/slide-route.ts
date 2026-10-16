import type { ChartNote, SlidePoint } from './chart';

/** Holds run vertically; each change is a horizontal bridge at its exact MIDI timestamp. */
export function slideRoute(note: ChartNote): SlidePoint[] {
  if (note.gimmick !== 'slide' || note.type !== 'hold') return [];
  const route: SlidePoint[] = [{time:note.time, lane:note.lane}];
  let lane = note.lane;
  for (const point of note.path ?? []) {
    route.push({time:point.time, lane}, {...point}); lane = point.lane;
  }
  route.push({time:note.endTime, lane});
  return route;
}
