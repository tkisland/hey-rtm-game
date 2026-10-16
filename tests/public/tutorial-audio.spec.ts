import {test, expect} from '@playwright/test';

test('sound check produces real output, shares one playback session with practice, and volume zero is silent', async ({page}) => {
  const preferences = {sound:false,soundVolume:0,soundDelay:300};
  await page.addInitScript(preferences => {
    localStorage.setItem('hey-rhythm-settings-v1',JSON.stringify(preferences));
    const state = (window as any).practiceAudio = {contexts:[] as AudioContext[], sessionTypes:[] as string[], rms:0, starts:[] as number[]};
    let sessionType = 'auto';
    Object.defineProperty(navigator,'audioSession',{configurable:true,value:{get type() {return sessionType;}, set type(value) {sessionType=value;}}});
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args); state.contexts.push(this); state.sessionTypes.push(sessionType);
      }
      createBufferSource() {
        const source = super.createBufferSource(), start = source.start.bind(source);
        source.start = (...args: Parameters<typeof start>) => {state.starts.push((args[0] ?? 0) - this.currentTime); start(...args);};
        return source;
      }
    };
    // Measure the signal after the limiter, immediately before the real output.
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination: any, ...args: any[]): any {
      if (destination === this.context.destination) {
        const meter = this.context.createAnalyser(); meter.fftSize = 256;
        (connect as any).call(this,meter); (connect as any).call(meter,destination,...args);
        const data = new Float32Array(meter.fftSize);
        setInterval(() => {meter.getFloatTimeDomainData(data); state.rms=Math.max(state.rms,Math.sqrt(data.reduce((sum,x) => sum+x*x,0)/data.length));},5);
        return destination;
      }
      return (connect as any).call(this,destination,...args);
    };
  }, preferences);
  await page.goto('/'); await page.locator('#open-tutorial').click();
  await expect(page.locator('#tutorial-sound')).not.toBeChecked();
  await expect(page.locator('#tutorial-audio-status')).toHaveText('音：OFF');
  expect(await page.evaluate(() => (window as any).practiceAudio.contexts.length)).toBe(0);
  await page.locator('#tutorial-sound-test').click();
  await expect(page.locator('#tutorial-sound')).toBeChecked();
  await expect.poll(() => page.evaluate(() => (window as any).practiceAudio.rms)).toBeGreaterThan(.005);
  await expect(page.locator('#tutorial-volume')).toHaveValue('70');
  const initial = await page.evaluate(() => ({types:(window as any).practiceAudio.sessionTypes, starts:(window as any).practiceAudio.starts}));
  expect(initial.types).toEqual(['playback']); expect(initial.starts).toHaveLength(1);
  expect(initial.starts[0]).toBeLessThan(.01); // Reference ignores the saved 300ms input-sound delay.
  await page.locator('#tutorial-volume').fill('35'); await page.locator('#tutorial-volume').dispatchEvent('input');
  await expect(page.locator('#tutorial-volume-value')).toHaveText('35%');
  await page.locator('#tutorial-start').click();
  await expect(page.locator('#tutorial-start')).toHaveText('もう一度');
  await page.locator('#tutorial-volume').fill('0'); await page.locator('#tutorial-volume').dispatchEvent('input');
  await expect(page.locator('#tutorial-audio-status')).toHaveText('音：OFF（音量0%）');
  await page.waitForTimeout(150); await page.evaluate(() => { (window as any).practiceAudio.rms=0; });
  await page.waitForTimeout(750); // Pass a reference beat while muted.
  expect(await page.evaluate(() => (window as any).practiceAudio.rms)).toBeLessThan(.00001);
  await page.locator('#tutorial-next').click(); await page.locator('#tutorial-sound-test').click();
  await expect.poll(() => page.evaluate(() => (window as any).practiceAudio.rms)).toBeGreaterThan(.005);
  expect(await page.evaluate(() => (window as any).practiceAudio.contexts.length)).toBe(1);
  await page.locator('#tutorial-sound').uncheck();
  expect(await page.evaluate(() => (navigator as any).audioSession.type)).toBe('auto');
  await page.locator('#tutorial-sound-test').click(); await page.locator('#tutorial-close').click();
  await expect.poll(() => page.evaluate(() => (window as any).practiceAudio.contexts[0].state)).toBe('closed');
  expect(await page.evaluate(() => (navigator as any).audioSession.type)).toBe('auto');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('hey-rhythm-settings-v1')!))).toEqual(preferences);
});

test('an audio context that stays suspended shows a retry message and recovers on sound check without restarting practice', async ({page}) => {
  await page.clock.install({time:new Date('2026-10-16T00:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-16T00:00:01Z'));
  await page.addInitScript(() => {
    const state = (window as any).blockedPracticeAudio = {blocked:true,contexts:0,starts:0};
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {super(...args);state.contexts++;}
      get state(): AudioContextState {return state.blocked ? 'suspended' : super.state;}
      resume() {return state.blocked ? Promise.resolve() : super.resume();}
      createBufferSource() {
        const source=super.createBufferSource(), start=source.start.bind(source);
        source.start=(...args:Parameters<typeof start>) => {state.starts++;start(...args);};return source;
      }
    };
  });
  await page.goto('/'); await page.locator('#open-tutorial').click(); await page.locator('#tutorial-start').click();
  await expect(page.locator('#tutorial-start')).toHaveText('もう一度');
  await expect(page.locator('#tutorial-audio-status')).toContainText('音を再生できません');
  expect(await page.evaluate(() => (window as any).blockedPracticeAudio.starts)).toBe(0);
  await page.evaluate(() => { (window as any).blockedPracticeAudio.blocked=false; });
  await page.locator('#tutorial-sound-test').click();
  await expect(page.locator('#tutorial-audio-status')).toHaveText('確認音を再生しました。');
  expect(await page.evaluate(() => (window as any).blockedPracticeAudio.contexts)).toBe(1);
  expect(await page.evaluate(() => (window as any).blockedPracticeAudio.starts)).toBe(1);
  await expect(page.locator('#tutorial-start')).toHaveText('もう一度');
  await expect(page.locator('#tutorial-score')).toHaveText('0 点 · COMBO 0');
});
