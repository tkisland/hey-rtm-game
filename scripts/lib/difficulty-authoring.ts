import type {Chart,ChartNote} from '../../src/chart';
import {copyNote} from '../../src/chart';
import {copyChart} from '../../src/chart-data';
import {playableNotes} from '../../src/note-display';
import {beatToTime,timeToBeat} from '../../src/tempo';

const hand=(lane:number)=>lane<3?0:1;
const end=(note:ChartNote)=>note.type==='hold'?note.endTime:note.time;
function heads(notes:readonly ChartNote[]):ChartNote[][] {
  const groups:ChartNote[][]=[];
  for(const note of [...notes].sort((a,b)=>a.time-b.time||a.id-b.id)) {
    const previous=groups.at(-1);
    if(previous && note.time-previous[0].time<=.001+1e-8)previous.push(note);
    else groups.push([note]);
  }
  return groups;
}
/** Offline authoring only. The game loads the exported, independently editable JSON. */
export function easyChart(source:Chart):Chart {
  const result=copyChart(source);result.notes=[];
  const groups=heads(playableNotes(source.notes));let previousBeat=-Infinity,previousHand=-1;
  for(const [index,group] of groups.entries()) {
    const time=group[0].time,beat=timeToBeat(source,time),gap=beat-previousBeat;
    const even=Math.abs(beat/2-Math.round(beat/2))<.045;
    const phraseAccent=Math.abs(beat-Math.round(beat))<.09 && ((Math.round(beat)%8)+8)%8===7;
    if(index!==0 && index!==groups.length-1 && !(gap>=1.9 || even&&gap>=1.7 || phraseAccent&&gap>=.95))continue;
    const busy=result.notes.filter(n=>n.type==='hold'&&n.endTime+.12>time).map(n=>hand(n.lane));
    const candidates=group.filter(n=>!busy.includes(hand(n.lane))).sort((a,b)=>Number(hand(a.lane)===previousHand)-Number(hand(b.lane)===previousHand)||a.id-b.id);
    if(!candidates.length)continue;
    if(index===groups.length-1)candidates.sort((a,b)=>end(b)-end(a));
    const first=candidates[0];
    const simple=(note:ChartNote):ChartNote=>{
      if(note.gimmick==='box'||note.gimmick==='dd')return {id:note.id,time:note.time,lane:note.lane,type:'tap',gimmick:'dd'};
      if(note.type==='hold')return {id:note.id,time:note.time,lane:note.lane,type:'hold',endTime:index===groups.length-1?note.endTime:Math.min(note.endTime,beatToTime(source,timeToBeat(source,note.time)+2))};
      return {id:note.id,time:note.time,lane:note.lane,type:'tap'};
    };
    result.notes.push(simple(first));
    // A few clear left/right chords; all other chords become a single response.
    if(!busy.length && first.type==='tap' && !first.gimmick && Math.abs(beat/8-Math.round(beat/8))<.012) {
      const other=candidates.find(n=>n.type==='tap'&&!n.gimmick&&hand(n.lane)!==hand(first.lane));
      if(other)result.notes.push(simple(other));
    }
    previousBeat=beat;previousHand=hand(first.lane);
  }
  result.notes.sort((a,b)=>a.time-b.time||a.lane-b.lane);
  result.startTime=result.notes[0].time;return result;
}

export function hardChart(source:Chart):Chart {
  const result=copyChart(source),original=playableNotes(source.notes),groups=heads(original);
  let id=Math.max(...source.notes.map(n=>n.id))+1;
  const holds=original.filter(n=>n.type==='hold');
  const wide=original.filter(n=>n.gimmick==='box'||n.gimmick==='dd');
  const protectedTime=(time:number)=>holds.some(n=>time>=n.time-.18&&time<=end(n)+.2)||wide.some(n=>Math.abs(n.time-time)<(n.gimmick==='box'?.6:.22));
  const allTaps=original.filter(n=>n.type==='tap'&&!n.gimmick);
  const add=(time:number,preferred:number,forceHand?:number):boolean=>{
    if(protectedTime(time))return false;
    const nearby=allTaps.filter(n=>Math.abs(n.time-time)<.18);
    const simultaneous=nearby.filter(n=>Math.abs(n.time-time)<.001);
    if(simultaneous.length>=2)return false;
    const lanes=Array.from({length:6},(_,i)=>(preferred+i)%6).filter(lane=>forceHand===undefined||hand(lane)===forceHand);
    const lane=lanes.find(lane=>!nearby.some(n=>n.lane===lane || hand(n.lane)===hand(lane)&&Math.abs(n.time-time)<.115));
    if(lane===undefined)return false;
    const note:ChartNote={id:id++,time,lane,type:'tap'};result.notes.push(note);allTaps.push(note);return true;
  };
  // Strong accents become two-thumb chords, with rests around wide/held gestures.
  for(const group of groups) {
    const note=group[0],beat=timeToBeat(source,note.time);
    if(group.length===1&&note.type==='tap'&&!note.gimmick&&Math.abs(beat/2-Math.round(beat/2))<.035&&Math.floor(beat/4)%2===1)
      add(note.time,5-note.lane,1-hand(note.lane));
  }
  for(let index=0;index<groups.length-1;index++) {
    const current=groups[index],next=groups[index+1],start=current[0].time,finish=next[0].time;
    if(current.length!==1||next.length!==1||current[0].gimmick||next[0].gimmick||current[0].type!=='tap'||next[0].type!=='tap')continue;
    const first=timeToBeat(source,start),last=timeToBeat(source,finish),gap=last-first;
    if(gap<.45||gap>1.05)continue; // Preserve authored silences and syncopation.
    const bar=Math.floor(first/4),phase=((Math.round(first*2)%8)+8)%8;
    if(bar%4===0&&phase<4)continue; // Breathing room in each four-bar phrase.
    const offsets=gap>.9&&bar%4===3&&phase>=4?[.25,.5,.75]:[.5];
    for(const offset of offsets) {
      const beat=first+gap*offset;
      // Use a local musical subdivision, including changes between the two heads.
      const time=beatToTime(source,beat);
      const previous=[...allTaps].filter(n=>n.time<time-.001).sort((a,b)=>b.time-a.time)[0];
      const position=(Math.floor(first*2)+Math.round(offset*4))%4;
      const preferred=previous?(hand(previous.lane)===0?[5,4,3,4][position]:[0,1,2,1][position]):5-current[0].lane;
      add(time,preferred);
    }
  }
  result.notes.sort((a,b)=>a.time-b.time||a.lane-b.lane||a.id-b.id);
  return result;
}
