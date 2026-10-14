/** Positive compensation subtracts the measured input delay; never shifts the video clock. */
export function compensateInput(time: number, delayMs: number): number { return time - delayMs / 1000; }
