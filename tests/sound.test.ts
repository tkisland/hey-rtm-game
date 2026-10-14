import { expect, it } from 'vitest';
import { createTapSamples, TAP_DURATION } from '../src/sound';
import { normalizeSettings } from '../src/settings';

it.each([44100, 48000])('creates finite short click samples without clipped peaks or cut-off edges at %s Hz', sampleRate => {
  for (let lane = 0; lane < 6; lane++) {
    const samples = createTapSamples(sampleRate, lane);
    expect(samples.length).toBe(Math.ceil(sampleRate * TAP_DURATION));
    expect(Math.abs(samples[0])).toBe(0);
    expect(Math.abs(samples[samples.length - 1])).toBe(0);
    expect(samples.every(Number.isFinite)).toBe(true);
    const peak = Math.max(...samples.map(Math.abs));
    expect(peak).toBeGreaterThan(0.79);
    expect(peak).toBeLessThan(0.81);
    const window = Math.floor(sampleRate * 0.015);
    const rms = (data: Float32Array) => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
    expect(rms(samples.slice(0, window))).toBeGreaterThan(rms(samples.slice(-window)) * 20);
  }
});
it('keeps the same click for each lane while distinguishing the six lane sounds', () => {
  const lane = createTapSamples(48000, 0);
  expect(createTapSamples(48000, 0)).toEqual(lane);
  for (let i = 1; i < 6; i++) expect(createTapSamples(48000, i)).not.toEqual(lane);
});
it('validates tap volume and retains preferences from before the volume setting existed', () => {
  expect(normalizeSettings({ sound: false }).soundVolume).toBe(70);
  expect(normalizeSettings({ soundVolume: 104 }).soundVolume).toBe(100);
  expect(normalizeSettings({ soundVolume: -1 }).soundVolume).toBe(0);
  expect(normalizeSettings({ soundVolume: 42 }).soundVolume).toBe(40);
  expect(normalizeSettings({ soundVolume: NaN }).soundVolume).toBe(70);
});
