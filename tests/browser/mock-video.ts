import type { Page } from '@playwright/test';

// Test-only IFrame API adapter. Production has no fake clock or simulated playback.
export const api = `
window.YT = { Player: class {
  constructor(id, options) {
    this.time = 0; this.state = -1; this.liveClock = true; this.updateInterval = 0; this.rate = 1; this.anchor = performance.now(); this.options = options;
    const frame = document.createElement('iframe'); frame.src = 'about:blank';
    document.getElementById(id).replaceWith(frame);
    window.testVideo = this;
    setTimeout(() => options.events.onReady({target:this}), 0);
  }
  getCurrentTime() {
    const time = this.time + (this.state === 1 && this.liveClock ? (performance.now()-this.anchor)/1000 * this.rate : 0);
    return this.updateInterval ? Math.floor(time / this.updateInterval) * this.updateInterval : time;
  }
  getPlayerState() { return this.state; }
  getDuration() { return 220; }
  getPlaybackRate() { return this.rate; }
  getAvailablePlaybackRates() { return [0.5, 0.75, 1]; }
  setPlaybackRate(rate) {
    if (!this.getAvailablePlaybackRates().includes(rate)) return;
    this.time = this.getCurrentTime(); this.anchor = performance.now(); this.rate = rate;
    this.options.events.onPlaybackRateChange?.({target:this,data:rate});
  }
  seekTo(t) { this.time = t; this.anchor = performance.now(); }
  setState(state) { this.time = this.getCurrentTime(); this.anchor = performance.now(); this.state = state; this.options.events.onStateChange({target:this,data:state}); }
  playVideo() { this.setState(1); }
  pauseVideo() { this.setState(2); }
  destroy() {}
}};
window.onYouTubeIframeAPIReady();`;
export async function seekPlay(page: Page, time: number) {
  await page.evaluate(time => {
    const video = (window as any).testVideo;
    video.setState(2); video.seekTo(time);
  }, time);
  await page.waitForTimeout(50);
  await page.evaluate(() => (window as any).testVideo.playVideo());
}

/** Wait on animation frames so an endpoint release stays inside its timing window. */
export async function waitForVideoTime(page: Page, time: number) {
  await page.waitForFunction(time => (window as any).testVideo.getCurrentTime() >= time, time, {polling:"raf"});
}
