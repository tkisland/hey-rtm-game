export const DIFFICULTIES = [
  {id:'easy',label:'かんたん'},
  {id:'normal',label:'ふつう'},
  {id:'hard',label:'むずかしい'},
] as const;
export type Difficulty = typeof DIFFICULTIES[number]['id'];
export const DEFAULT_DIFFICULTY: Difficulty = 'normal';
export function findDifficulty(value: string | null): Difficulty | undefined {
  return value === null ? DEFAULT_DIFFICULTY : DIFFICULTIES.find(item=>item.id===value)?.id;
}
export function difficultyLabel(value: Difficulty): string { return DIFFICULTIES.find(item=>item.id===value)!.label; }
/** Normal keeps the existing documents and revisions; new levels cannot overwrite them. */
export function cloudChartPath(collection: 'draftCharts'|'publishedCharts', songId: string, difficulty: Difficulty): string[] {
  return difficulty === DEFAULT_DIFFICULTY ? [collection,songId] : [collection,songId,'difficulties',difficulty];
}
