import {expect,it} from 'vitest';
import {readYouTubeMetadata} from '../src/youtube';
import type {YouTubePlayer} from '../src/youtube';
it('reads supported metadata without modifying player state or seeking',()=>{
  const player={getDuration:()=>220,getVideoLoadedFraction:()=>.4,getVideoUrl:()=> 'https://www.youtube.com/watch?v=pJDfWpZ7CI4&feature=share'} as YouTubePlayer;
  expect(readYouTubeMetadata(player)).toEqual({videoDuration:220,loadedFraction:.4,reportedVideoId:'pJDfWpZ7CI4'});
});
it('isolates unavailable or throwing getters so diagnostics cannot stop gameplay',()=>{
  const player={getDuration:()=>{throw Error('Unavailable during transition');},getVideoLoadedFraction:()=>.5,getVideoUrl:()=>{throw Error('Unavailable');}} as YouTubePlayer;
  expect(readYouTubeMetadata(player)).toEqual({videoDuration:null,loadedFraction:.5,reportedVideoId:null});
  expect(readYouTubeMetadata({getDuration:()=>NaN} as YouTubePlayer)).toEqual({videoDuration:null,loadedFraction:null,reportedVideoId:null});
  expect(readYouTubeMetadata({getDuration:()=>-1,getVideoLoadedFraction:()=>2,getVideoUrl:()=> 'invalid'} as YouTubePlayer)).toEqual({videoDuration:null,loadedFraction:null,reportedVideoId:null});
});
