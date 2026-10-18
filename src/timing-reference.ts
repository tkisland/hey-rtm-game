import type { Song } from './songs';
import { NOTE_TRAVEL_SECONDS } from './settings';
import { compensateInput } from './timing';

/** Original 18s calibration video: countdown at 3/4/5s, cues at 6..15s. */
export const TIMING_REFERENCE: Song = {
  id: 'timing-reference', title: 'タイミング調整用動画', artist: 'Hey! Rhythm!',
  videoId: 'SFqCNFPPqBE', bpm: 60, startTime: 6,
};
export const TIMING_CUES = Array.from({ length: 10 }, (_, i) => ({ number: i + 1, time: 6 + i }));
export function referenceProgress(videoTime: number, cueTime: number, noteOffset: number): number {
  return 1 + (compensateInput(videoTime, noteOffset) - cueTime) / NOTE_TRAVEL_SECONDS;
}

/** One numbered lane: compare its center with the line, without musical interpretation. */
export function drawTimingReference(canvas: HTMLCanvasElement, videoTime: number, noteOffset: number): void {
  const { width, height } = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  if (!width || !height) return;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0d101d'; ctx.fillRect(0, 0, width, height);
  const x = width / 2, top = 24, target = height - 44, distance = target - top, radius = 19;
  ctx.fillStyle = '#d4f98b0a'; ctx.fillRect(x - 32, top, 64, distance);
  ctx.strokeStyle = '#52617b'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, target); ctx.stroke();
  const corrected = compensateInput(videoTime, noteOffset);
  const flashing = TIMING_CUES.some(cue => corrected >= cue.time && corrected < cue.time + .1);
  ctx.strokeStyle = flashing ? '#d4f98b' : '#f6f7ff'; ctx.lineWidth = 2;
  ctx.shadowColor = '#d4f98b'; ctx.shadowBlur = flashing ? 12 : 0;
  ctx.beginPath(); ctx.moveTo(18, target); ctx.lineTo(width - 18, target); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, target, radius + 4, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#dbe3f5'; ctx.fillText('横線に重なる瞬間が正解', x, height - 13);
  for (const cue of TIMING_CUES) {
    const progress = referenceProgress(videoTime, cue.time, noteOffset);
    if (progress < 0 || progress > 1.1) continue;
    const y = top + distance * progress;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#d4f98b'; ctx.fill(); ctx.strokeStyle = '#f8ffe3'; ctx.stroke();
    ctx.fillStyle = '#12191a'; ctx.font = 'bold 21px sans-serif'; ctx.fillText(String(cue.number), x, y + 1);
  }
}
