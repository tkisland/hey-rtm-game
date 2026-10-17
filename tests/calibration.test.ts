import { describe, expect, it } from 'vitest';
import { CALIBRATION, CalibrationMeasurement, NoteTimingCalibration } from '../src/calibration';
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

describe('calibration from moving notes', () => {
  it('needs eight stable original timestamps and replaces rather than accumulates correction', () => {
    const measurement = new NoteTimingCalibration();
    for (let i=0;i<7;i++) expect(measurement.tap(i,20+i*.9+.08,20+i*.9)).toEqual({ok:false,reason:'insufficient'});
    expect(measurement.tap(7,26.38,26.3)).toMatchObject({ok:true,offset:80,samples:8});
    // Continued taps are on the same heard beat after the visual/judgement correction changes.
    for (let i=8;i<20;i++) expect(measurement.tap(i,20+i*.9+.08,20+i*.9)).toMatchObject({ok:true,offset:80});
    expect(measurement.count).toBe(10);
    measurement.clear(); expect(measurement.count).toBe(0);
    expect(measurement.tap(0,20.08,20)).toEqual({ok:false,reason:'insufficient'});
  });
  it('rejects duplicates and off-beat taps while recovering from isolated mistakes', () => {
    const measurement = new NoteTimingCalibration();
    expect(measurement.tap(1,19,20)).toBeNull();
    expect(measurement.tap(1,NaN,20)).toBeNull();
    expect(measurement.tap(1,20.08,20)).not.toBeNull();
    expect(measurement.tap(1,20.1,20)).toBeNull(); expect(measurement.count).toBe(1);
    [80,80,80,80,80,80,350].forEach((ms,i)=>measurement.tap(i+2,21+i+ms/1000,21+i));
    expect(measurement.tap(9,29.08,29)).toMatchObject({ok:true,offset:80,samples:8});
  });
  it('supports negative correction and both limits without clamping excessive or unstable results', () => {
    for(const ms of [-300,-100,300,340]) {
      const measurement = new NoteTimingCalibration(); let result;
      for(let i=0;i<10;i++) result=measurement.tap(i,20+i+ms/1000,20+i);
      expect(result).toMatchObject(ms===340 ? {ok:false,reason:'range'} : {ok:true,offset:ms});
    }
    const measurement = new NoteTimingCalibration(); let result;
    [0,170,-170,20,160,-180,15,-150,180,5].forEach((ms,i)=>{result=measurement.tap(i,20+i+ms/1000,20+i);});
    expect(result).toEqual({ok:false,reason:'unstable'});
  });
});
