import {expect,it} from 'vitest';
import {slideRoute} from '../src/slide-route';
import type {HoldNote} from '../src/chart';

it('keeps holds on one lane and connects both sides at each exact checkpoint timestamp', () => {
  const note:HoldNote={id:1,type:'hold',gimmick:'slide',time:1,lane:2,path:[{time:3,lane:3},{time:5,lane:2},{time:6,lane:1}],endTime:8};
  expect(slideRoute(note)).toEqual([{time:1,lane:2},{time:3,lane:2},{time:3,lane:3},{time:5,lane:3},{time:5,lane:2},{time:6,lane:2},{time:6,lane:1},{time:8,lane:1}]);
  for(const [i,point] of slideRoute(note).entries())if(i) {
    const previous=slideRoute(note)[i - 1];
    expect(point.lane === previous.lane || point.time === previous.time).toBe(true);
  }
});
it('does not apply a slide route to ordinary holds or taps, and does not alias chart points', () => {
  expect(slideRoute({id:1,type:'tap',time:1,lane:0})).toEqual([]);
  expect(slideRoute({id:1,type:'hold',time:1,endTime:3,lane:0})).toEqual([]);
  const note:HoldNote={id:1,type:'hold',gimmick:'slide',time:1,endTime:3,lane:0,path:[{time:2,lane:1}]};
  slideRoute(note)[2].time=99;expect(note.path![0].time).toBe(2);
});
