/** Positive compensation subtracts the measured input delay; never shifts the video clock. */
export function compensateInput(time: number, delayMs: number, playbackRate = 1): number { return time - delayMs / 1000 * playbackRate; }
