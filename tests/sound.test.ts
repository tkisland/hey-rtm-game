import { expect, it } from 'vitest';
import { BEAT_DURATION, BOX_DURATION, BOX_PITCHES, createBeatSamples, createBoxSamples, createHoldSamples, createTapSamples, TAP_DURATION } from '../src/sound';
import { normalizeSettings } from '../src/settings';

it.each([44100,48000])('creates a bounded, audible reference beat with smooth edges at %s Hz', sampleRate => {
  const samples = createBeatSamples(sampleRate);
  const rms = (data: Float32Array) => Math.sqrt(data.reduce((sum, v) => sum + v*v, 0) / data.length);
  expect(samples.length).toBe(Math.ceil(BEAT_DURATION * sampleRate));
  expect(samples.every(Number.isFinite)).toBe(true);
  expect(Math.abs(samples[0])).toBe(0); expect(Math.abs(samples.at(-1)!)).toBe(0);
  expect(Math.max(...samples.map(Math.abs))).toBeLessThan(.7);
  expect(rms(samples.slice(0,sampleRate*.02))).toBeGreaterThan(.1);
  expect(rms(samples.slice(-sampleRate*.01))).toBeLessThan(.01);
});

it.each([44100, 48000])('plays a rising six-note box run with finite, fading bell tones at %s Hz', sampleRate => {
  const energyAt = (samples: Float32Array, frequency: number) => {
    let real = 0, imaginary = 0;
    for (let i = 0; i < samples.length; i++) {
      const phase = 2 * Math.PI * frequency * i / sampleRate;
      real += samples[i] * Math.cos(phase); imaginary += samples[i] * Math.sin(phase);
    }
    return real * real + imaginary * imaginary;
  };
  for (let step = 0; step < 6; step++) {
    const samples = createBoxSamples(sampleRate, step);
    expect(samples.length).toBe(Math.ceil(sampleRate * BOX_DURATION));
    expect(samples.every(Number.isFinite)).toBe(true);
    expect(Math.abs(samples[0])).toBe(0); expect(Math.abs(samples.at(-1)!)).toBe(0);
    expect(Math.max(...samples.map(Math.abs))).toBeCloseTo(.48, 5);
    const energies = BOX_PITCHES.map(frequency => energyAt(samples, frequency));
    expect(energies.indexOf(Math.max(...energies))).toBe(step);
    const rms = (window: Float32Array) => Math.sqrt(window.reduce((sum, v) => sum + v * v, 0) / window.length);
    expect(rms(samples.slice(-sampleRate * .02))).toBeLessThan(rms(samples.slice(0, sampleRate * .02)) * .1);
    if (step) expect(BOX_PITCHES[step]).toBeGreaterThan(BOX_PITCHES[step - 1]);
  }
});

it.each([44100, 48000])('creates finite short cymbal samples without clipped peaks or cut-off edges at %s Hz', sampleRate => {
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
it('keeps the same cymbal for each lane while distinguishing the six lane sounds', () => {
  const lane = createTapSamples(48000, 0);
  expect(createTapSamples(48000, 0)).toEqual(lane);
  for (let i = 1; i < 6; i++) expect(createTapSamples(48000, i)).not.toEqual(lane);
});
it.each([44100, 48000])('has a bright noise spectrum and an audible, decaying shimmer at %s Hz', sampleRate => {
  for (let lane = 0; lane < 6; lane++) {
    const samples = createTapSamples(sampleRate, lane);
    const alpha = 1 - Math.exp(-2 * Math.PI * 1500 / sampleRate);
    let low = 0, energy = 0, lowEnergy = 0;
    for (const sample of samples) {
      low += alpha * (sample - low); energy += sample * sample; lowEnergy += low * low;
    }
    // The old pitched click concentrated energy near 1kHz. A cymbal should stay bright.
    expect(lowEnergy / energy).toBeLessThan(0.2);
    const rms = (start: number, end: number) => {
      const window = samples.slice(Math.floor(start * sampleRate), Math.floor(end * sampleRate));
      return Math.sqrt(window.reduce((sum, value) => sum + value * value, 0) / window.length);
    };
    expect(rms(0.06, 0.1)).toBeGreaterThan(0.01);
    expect(rms(0.06, 0.1)).toBeLessThan(rms(0, 0.015) * 0.5);
    expect(rms(0.225, 0.24)).toBeLessThan(rms(0.06, 0.1) * 0.1);
  }
});
it('validates tap volume and retains preferences from before the volume setting existed', () => {
  expect(normalizeSettings({ sound: false }).soundVolume).toBe(70);
  expect(normalizeSettings({ soundVolume: 104 }).soundVolume).toBe(100);
  expect(normalizeSettings({ soundVolume: -1 }).soundVolume).toBe(0);
  expect(normalizeSettings({ soundVolume: 42 }).soundVolume).toBe(40);
  expect(normalizeSettings({ soundVolume: NaN }).soundVolume).toBe(70);
});
it.each([44100, 48000])('creates a seamless sustained metallic loop with bounded peaks at %s Hz', sampleRate => {
  for (let lane = 0; lane < 6; lane++) {
    const samples = createHoldSamples(sampleRate, lane), half = samples.length / 2;
    expect(samples.length).toBe(sampleRate * 0.2);
    expect(samples.every(Number.isFinite)).toBe(true);
    expect(Math.max(...samples.map(Math.abs))).toBeCloseTo(0.45, 5);
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.001);
    // A repeated period at the midpoint has exactly the same transition as the loop seam.
    for (let i = 0; i < half; i++) expect(samples[i]).toBeCloseTo(samples[i + half], 6);
    expect(samples[0] - samples.at(-1)!).toBeCloseTo(samples[half] - samples[half - 1], 6);
    const rms = (start: number, count: number) => Math.sqrt(samples.slice(start, start + count).reduce((sum, value) => sum + value * value, 0) / count);
    expect(rms(half, half)).toBeCloseTo(rms(0, half), 6);
    const windows = Array.from({ length: 20 }, (_, i) => rms(Math.floor(i * sampleRate * 0.01), Math.floor(sampleRate * 0.01)));
    expect(Math.min(...windows)).toBeGreaterThan(0.02);
    expect(Math.max(...windows) / Math.min(...windows)).toBeGreaterThan(1.5);
  }
});
