import { describe, expect, it } from 'vitest';
import { CALIBRATION, CalibrationMeasurement } from '../src/calibration';
function measure(offsets: number[]) {
  const session = new CalibrationMeasurement(20);
  offsets.forEach((offset, beat) => session.tap(session.firstMeasured + beat * CALIBRATION.interval + offset / 1000));
  return session;
}
describe('audio reference calibration', () => {
  it('measures late input on the audio clock and rounds its median to the saved 5ms step', () => {
    expect(measure([81, 83, 79, 83, 82, 84, 81, 83, 82, 82]).result()).toEqual({ ok: true, offset: 80, samples: 10, spread: 5 });
  });
  it('measures early taps as a negative correction and normalizes negative zero', () => {
    expect(measure(Array(10).fill(-100)).result()).toMatchObject({ ok: true, offset: -100 });
    expect(Object.is((measure(Array(10).fill(-1)).result() as { offset: number }).offset, 0)).toBe(true);
  });
  it('ignores warmup, double taps, off-beat taps, invalid timestamps and taps after the session', () => {
    const session = new CalibrationMeasurement(20);
    expect(session.tap(20)).toBe(false);
    expect(session.tap(session.firstMeasured - 0.44)).toBe(false);
    expect(session.tap(NaN)).toBe(false);
    expect(session.tap(Infinity)).toBe(false);
    expect(session.tap(session.firstMeasured + 0.08)).toBe(true);
    expect(session.tap(session.firstMeasured + 0.09)).toBe(false);
    expect(session.tap(session.end + 1)).toBe(false);
    expect(session.taps.size).toBe(1);
  });
  it('ignores isolated slips while retaining eight good taps', () => {
    expect(measure([80, 82, 78, 300, 81, 80, -220, 79, 82, 80]).result()).toEqual({ ok: true, offset: 80, samples: 8, spread: 4 });
  });
  it('rejects insufficient, irregular and excessive-offset measurements', () => {
    expect(measure(Array(7).fill(80)).result()).toEqual({ ok: false, reason: 'insufficient' });
    expect(measure([0, 170, -170, 20, 160, -180, 15, -150, 180, 5]).result()).toEqual({ ok: false, reason: 'unstable' });
    expect(measure([80, 80, 80, 80, 80, 80, 80, -220, 220, -200]).result()).toEqual({ ok: false, reason: 'unstable' });
    expect(measure(Array(10).fill(340)).result()).toEqual({ ok: false, reason: 'range' });
    expect(measure(Array(10).fill(-340)).result()).toEqual({ ok: false, reason: 'range' });
  });
  it('keeps the identity of beats after missed taps', () => {
    const session = new CalibrationMeasurement(10);
    for (const beat of [0, 1, 3, 4, 5, 7, 8, 9]) session.tap(session.firstMeasured + beat * CALIBRATION.interval + 0.1);
    expect(session.result()).toEqual({ ok: true, offset: 100, samples: 8, spread: 0 });
    expect([...session.taps.keys()]).toEqual([0, 1, 3, 4, 5, 7, 8, 9]);
  });
  it('allows either edge of the correction range', () => {
    expect(measure(Array(10).fill(300)).result()).toMatchObject({ ok: true, offset: 300 });
    expect(measure(Array(10).fill(-300)).result()).toMatchObject({ ok: true, offset: -300 });
  });
});
