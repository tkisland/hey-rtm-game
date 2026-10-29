import {GameEngine,playLane} from './engine';
import type {Hit,PlayNote} from './engine';

type Event = {time:number;starts:PlayNote[];moves:PlayNote[];ends:PlayNote[]};
/** Advances authored operations on the video clock, including frames containing several notes. */
export class DemoPlayer {
  readonly pressed=new Set<number>();
  private holding=new Set<number>();
  private pulses=Array<number>(6).fill(-Infinity);
  private events:Event[]=[];
  private index=0;
  constructor(private game:GameEngine){this.reset();}
  reset():void {
    this.index=0;this.pressed.clear();this.holding.clear();this.pulses.fill(-Infinity);
    const events=new Map<number,Event>();
    const at=(time:number)=>{let event=events.get(time);if(!event){event={time,starts:[],moves:[],ends:[]};events.set(time,event);}return event;};
    for(const note of this.game.notes){
      at(note.time).starts.push(note);
      if(note.type==='hold'){
        at(note.endTime).ends.push(note);
        for(const point of note.path ?? [])at(point.time).moves.push(note);
      }
    }
    this.events=[...events.values()].sort((a,b)=>a.time-b.time);
    for(const event of this.events)event.starts.sort((a,b)=>Number(a.gimmick==='dd')-Number(b.gimmick==='dd'));
  }
  advance(time:number,onPress:(lane:number,at:number)=>void):Hit[] {
    const hits:Hit[]=[];
    const press=(lane:number,at:number)=>{this.pulses[lane]=at+.1;onPress(lane,at);};
    while(this.index<this.events.length && this.events[this.index].time<=time){
      const event=this.events[this.index++],at=event.time;
      for(const note of event.moves)if(note.state==='holding'){
        const point=note.path?.[note.pathIndex ?? 0];
        if(point?.time===at){this.holding.delete(playLane(note));this.holding.add(point.lane);press(point.lane,at);}
      }
      hits.push(...this.game.advance(at,this.holding));
      for(const note of event.ends)if(note.state==='holding'){
        const lane=playLane(note);hits.push(...this.game.release(lane,at));this.holding.delete(lane);
      }
      for(const note of event.starts)if(note.state==='pending'){
        if(note.gimmick==='box'){
          for(const lane of [2,3,1,4,0,5]){const hit=this.game.input(lane,at);if(hit)hits.push(hit);this.pulses[lane]=at+.1;}
        }else{
          const lane=note.gimmick==='dd'?[0,1,2,3,4,5].find(lane=>!this.holding.has(lane)) ?? note.lane:note.lane;
          const hit=this.game.input(lane,at);if(hit)hits.push(hit);
          press(lane,at);if(note.type==='hold'&&hit?.phase==='start')this.holding.add(lane);
        }
      }
      hits.push(...this.game.advance(at,this.holding));
    }
    hits.push(...this.game.advance(time,this.holding));
    this.pressed.clear();
    for(let lane=0;lane<6;lane++)if(this.holding.has(lane)||time<this.pulses[lane])this.pressed.add(lane);
    return hits;
  }
}
