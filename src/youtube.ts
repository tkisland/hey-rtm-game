import { DEFAULT_SONG } from './songs';
import type { Song } from './songs';
export interface YouTubePlayer {
  getCurrentTime(): number;
  getPlayerState(): number;
  getDuration(): number;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  setPlaybackRate(rate: number): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}
interface PlayerEvent { target: YouTubePlayer; data: number }
interface PlayerOptions {
  videoId: string;
  width: string;
  height: string;
  playerVars: Record<string, string | number>;
  events: { onReady(event: PlayerEvent): void; onStateChange(event: PlayerEvent): void; onError(event: PlayerEvent): void; onPlaybackRateChange(event: PlayerEvent): void; onApiChange(): void };
}
declare global {
  interface Window {
    YT?: { Player: new (element: string, options: PlayerOptions) => YouTubePlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}
const ERRORS: Record<number, string> = {
  2: '動画IDまたはプレーヤー設定を確認してください。',
  5: 'このブラウザで動画を再生できません。ページの再読み込みをお試しください。',
  100: '動画が非公開、または削除されています。',
  101: 'この動画は埋め込み再生が許可されていません。',
  150: 'この動画は埋め込み再生が許可されていません。',
  153: '再生元の識別情報（Referer）が不足しています。HTTP(S)で開き、サーバーのReferrer-Policyを確認してください。',
};
export function createYouTubePlayer(callbacks: {
  keyboardTarget?: HTMLElement;
  ready(player: YouTubePlayer): void;
  state(state: number): void;
  rate?(rate: number): void;
  error(message: string): void;
}, song: Song = DEFAULT_SONG): () => void {
  let disposed = false;
  let player: YouTubePlayer | null = null;
  let timer = 0;
  let focusFrame = 0;
  const clearTimer = () => window.clearTimeout(timer);
  const returnKeyboardFocus = () => {
    cancelAnimationFrame(focusFrame);
    // Key events inside YouTube's cross-origin iframe cannot reach our input handler.
    // Return focus after playback starts on PC, without scrolling or interrupting touch controls.
    if (!callbacks.keyboardTarget || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    focusFrame = requestAnimationFrame(() => {
      const iframe = document.querySelector<HTMLIFrameElement>('.video-frame iframe');
      if (!disposed && document.hasFocus() && iframe && document.activeElement === iframe && callbacks.keyboardTarget?.isConnected) callbacks.keyboardTarget.focus({ preventScroll: true });
    });
  };
  const init = () => {
    if (disposed || player || !window.YT?.Player) return;
    clearTimer();
    timer = window.setTimeout(() => callbacks.error('YouTubeプレーヤーの応答がありません。通信・コンテンツブロッカーを確認して再読み込みしてください。'), 20000);
    player = new window.YT.Player('youtube-player', {
      videoId: song.videoId, width: '100%', height: '100%',
      playerVars: { playsinline: 1, controls: 1, autoplay: 0, disablekb: 1, origin: location.origin },
      events: {
        onReady: event => {
          if (disposed) return;
          clearTimer();
          const iframe = document.querySelector<HTMLIFrameElement>('.video-frame iframe');
          if (iframe) {
            iframe.title = `${song.artist} ${song.title} 公式MV`;
            iframe.referrerPolicy = 'strict-origin-when-cross-origin';
          }
          callbacks.ready(event.target);
        },
        onStateChange: event => {
          if (disposed) return;
          cancelAnimationFrame(focusFrame);
          callbacks.state(event.data);
          if (event.data === 1) returnKeyboardFocus();
        },
        onPlaybackRateChange: event => { if (!disposed) callbacks.rate?.(event.data); },
        onApiChange: () => { if (!disposed && player) callbacks.rate?.(player.getPlaybackRate()); },
        onError: event => {
          cancelAnimationFrame(focusFrame);
          clearTimer();
          if (!disposed) callbacks.error(`YouTubeエラー ${event.data}：${ERRORS[event.data] ?? '動画を再生できません。通信状態を確認してください。'}`);
        },
      },
    });
  };
  window.onYouTubeIframeAPIReady = init;
  if (window.YT?.Player) init();
  else {
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => { clearTimer(); if (!disposed) callbacks.error('YouTube APIを読み込めません。通信・コンテンツブロッカーを確認して再読み込みしてください。'); };
    timer = window.setTimeout(() => callbacks.error('YouTube APIの読み込みがタイムアウトしました。通信状態を確認して再読み込みしてください。'), 20000);
    document.head.append(script);
  }
  return () => {
    disposed = true;
    cancelAnimationFrame(focusFrame);
    clearTimer();
    window.onYouTubeIframeAPIReady = undefined;
    player?.destroy();
  };
}
