import { LANE_COLORS } from './colors';
import { project } from './field-geometry';
import type { FieldGeometry } from './field-geometry';
import stageUrl from './assets/concert-venue.webp?url';

const artwork = new Image();
const scenes = new WeakMap<FieldGeometry,{canvas:HTMLCanvasElement;ready:boolean;dpr:number}>();

/** Cache the venue and fixed floor together; only lighting and notes need per-frame drawing. */
export function drawVenue(ctx:CanvasRenderingContext2D,field:FieldGeometry):void {
  if (!field.sharedVenue && !artwork.src) artwork.src = stageUrl;
  const ready = artwork.complete && artwork.naturalWidth > 0, dpr = Math.min(2,window.devicePixelRatio || 1);
  let scene = scenes.get(field);
  if (!scene || scene.ready !== ready || scene.dpr !== dpr) {
    const canvas = document.createElement('canvas'); canvas.width = Math.round(field.width*dpr);canvas.height = Math.round(field.height*dpr);
    const art = canvas.getContext('2d')!; art.scale(dpr,dpr);
    // Main gameplay draws the venue once behind both the monitor and canvas.
    // Tutorial/editor previews retain their self-contained concert background.
    if (!field.sharedVenue) {
      art.fillStyle='#080817';art.fillRect(0,0,field.width,field.height);
      if (ready) art.drawImage(artwork,0,0,field.width,field.origin*1536/225);
    }
    const padTop = field.pads[0].y - field.padHeight / 2 - 8;
    const consoleShade = art.createLinearGradient(0,padTop-14,0,padTop+28);
    consoleShade.addColorStop(0,'#08081700'); consoleShade.addColorStop(1,'#080817');
    art.fillStyle = consoleShade; art.fillRect(0,padTop-14,field.width,field.height-padTop+14);
    for (let lane = 0; lane < 6; lane++) {
      const color = LANE_COLORS[lane];
      const edges = [project(field, lane, 0, -.49),project(field, lane, 0, +.49),project(field, lane, 1, +.49),project(field, lane, 1, -.49)];
      const runway = art.createLinearGradient(0,field.origin,0,field.near);
      runway.addColorStop(0,field.sharedVenue?'#0b071bea':'#141121f5');
      runway.addColorStop(.4,field.sharedVenue?'#100a1cbd':'#151122ee');
      runway.addColorStop(1,color+(field.sharedVenue?'35':'48'));
      art.beginPath(); art.moveTo(edges[0].x,edges[0].y);
      for (const point of edges.slice(1)) art.lineTo(point.x,point.y);
      art.closePath(); art.fillStyle = runway; art.fill();
      art.strokeStyle = color+(field.sharedVenue?'ad':'75'); art.lineWidth = 1; art.stroke();
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
    const point=project(field,lane,0),y=field.origin-5,r=7+pulse*5,color=LANE_COLORS[lane];
    const light=ctx.createRadialGradient(point.x,y,0,point.x,y,r);
    light.addColorStop(0,'#fff');light.addColorStop(.2,color+'c0');light.addColorStop(1,color+'00');
    ctx.fillStyle=light;ctx.fillRect(point.x-r,y-r,r*2,r*2);
  }
  ctx.restore();
}
