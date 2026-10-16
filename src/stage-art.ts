import { LANE_COLORS } from './colors';
import { project } from './field-geometry';
import type { FieldGeometry } from './field-geometry';
import stageUrl from './assets/concert-stage.svg?url';

const artwork = new Image(); artwork.src = stageUrl;
const scenes = new WeakMap<FieldGeometry,{canvas:HTMLCanvasElement;ready:boolean;dpr:number}>();

/** Rasterize the venue once per resize; no per-frame crowd, blur or SVG work. */
export function drawVenue(ctx:CanvasRenderingContext2D,field:FieldGeometry):void {
  const ready = artwork.complete && artwork.naturalWidth > 0, dpr = Math.min(2,window.devicePixelRatio || 1);
  let scene = scenes.get(field);
  if (!scene || scene.ready !== ready || scene.dpr !== dpr) {
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(field.width*dpr);canvas.height = Math.ceil(field.height*dpr);
    const art = canvas.getContext('2d')!; art.scale(dpr,dpr);
    const haze=art.createRadialGradient(field.width*.5,field.origin,0,field.width*.5,field.origin,field.width*.7);
    haze.addColorStop(0,'#9347bd35');haze.addColorStop(1,'#a448cb00');
    art.fillStyle=haze;art.fillRect(0,0,field.width,field.height);
    if (ready) art.drawImage(artwork,0,0,field.width,field.origin*1.24);
    // Spectators stand outside the runway. Depth changes their size, never note speed.
    for(let side=0;side<2;side++) for(let i=0;i<88;i++) {
      const depth=(i+.5)/88, lane=side===0?-.5:5.5, edge=project(field,lane,depth);
      const spread=(i*37%23)/23, available=side===0?edge.x:field.width-edge.x;
      const x=side===0?available*spread:field.width-available*spread;
      const y=field.origin*1.22+depth*(field.approach*.84-field.origin*.22), scale=.35+depth*.65;
      const color=LANE_COLORS[(i+side*3)%6], tilt=(i%3-1)*2;
      art.fillStyle='#080a18';art.beginPath();art.arc(x,y,2.6*scale,0,Math.PI*2);art.fill();
      art.fillRect(x-3.5*scale,y+2*scale,7*scale,8*scale);
      if(i%3===0)continue;
      art.strokeStyle=color;art.lineWidth=1.6*scale;art.lineCap='round';art.shadowColor=color;art.shadowBlur=5;
      art.beginPath();art.moveTo(x+3*scale,y);art.lineTo(x+(3+tilt)*scale,y-(5+i%6)*scale);art.stroke();
      art.shadowBlur=0;
    }
    scene={canvas,ready,dpr};scenes.set(field,scene);
  }
  ctx.drawImage(scene.canvas,0,0,field.width,field.height);
}

/** The performers' responses glow at the source of the lanes. */
export function drawStage(ctx:CanvasRenderingContext2D,field:FieldGeometry,responses:readonly number[]):void {
  ctx.save();
  for(let lane=0;lane<6;lane++) {
    const pulse=responses[lane]??0;if(!pulse)continue;
    const point=project(field,lane,0),y=field.origin*1.24*241/360,r=7+pulse*5,color=LANE_COLORS[lane];
    const light=ctx.createRadialGradient(point.x,y,0,point.x,y,r);
    light.addColorStop(0,'#fff');light.addColorStop(.2,color+'c0');light.addColorStop(1,color+'00');
    ctx.fillStyle=light;ctx.fillRect(point.x-r,y-r,r*2,r*2);
  }
  ctx.restore();
}
