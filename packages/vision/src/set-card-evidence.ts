import {classifyFaceState, type FaceStateResult} from './face-state';
import type {RGBAImage} from './pixels';
import type {DetectedQuad} from './types';
import {fieldCenter, onMat, quadIou, type FieldCalibration} from './field-zones';

export const DEFAULT_SET_GUARDS = {positiveBack:true, prompt:true, ignore:true, startup:true, handRelease:true};
export type SetGuards = typeof DEFAULT_SET_GUARDS;
export type SetEvidence = {
  detector:number; pixel:FaceStateResult['state']; pixelConfidence:number;
  /** RMS RGB variation in the inner crop, on the 0..255 scale. */ sd:number|null;
  backDistance:number|null; positive:boolean; basis:'pixels'|'uniform'|'known-back'|'none'|'player'|'legacy';
  decision:'waiting'|'committed'|'prompted'|'ignored'|'not-a-card';
};
export type SetDecision = {id:string;at:number;zone:string;quad:DetectedQuad['quad'];guards:SetGuards;evidence:SetEvidence};
export type SetRegion = {quad:DetectedQuad['quad'];look:number[];clear:boolean;source:'startup'|'player';missingAt?:number};
/** Owner-local colour signatures and regions, per duel. Never sent to peers or diagnostics. */
export type SetCardMemory = {backs:number[][];ignored:SetRegion[]};
export const newSetCardMemory = ():SetCardMemory=>({backs:[],ignored:[]});
const W=12,H=16;
/** One small, portrait-ordered colour signature. Same work at every camera resolution. */
export function setCropLook(crop:RGBAImage):number[] {
  const look:number[]=[];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=(Math.min(crop.height-1,Math.floor((.1+.8*(y+.5)/H)*crop.height))*crop.width+Math.min(crop.width-1,Math.floor((.1+.8*(x+.5)/W)*crop.width)))*4;
    for(let c=0;c<3;c++)look.push(crop.data[i+c]/255);
  }
  return look;
}
/** Tight colour+texture match, including a half turn. Mean subtraction tolerates a small exposure change, never arbitrary colours. */
export function setLookDistance(a:readonly number[],b:readonly number[]):number {
  if(a.length!==W*H*3||b.length!==a.length)return 1;
  const means=(v:readonly number[])=>[0,1,2].map(c=>v.reduce((s,x,i)=>s+(i%3===c?x:0),0)/(W*H));
  const am=means(a),bm=means(b),colour=am.reduce((s,x,c)=>s+Math.abs(x-bm[c]),0)/3;
  let forward=0,reverse=0;
  for(let i=0;i<a.length;i++){const c=i%3,x=a[i]-am[c];forward+=Math.abs(x-(b[i]-bm[c]));reverse+=Math.abs(x-(b[(W*H-1-Math.floor(i/3))*3+c]-bm[c]));}
  return Math.min(forward,reverse)/a.length+colour*.5;
}
/** Experimental proxy supported by only two phantom episodes; matching a confirmed sleeve takes precedence for printed sleeves. */
export const SET_MAX_SD=40,SET_UNIFORM_SD=8,SET_BLIND_SD=18,SET_BACK_DISTANCE=.035;
export function measureSetEvidence(crop:RGBAImage|undefined,detector:Pick<DetectedQuad,'kind'|'confidence'>,observation:FaceStateResult,memory:SetCardMemory,sleeveBoundary=false,steadyDown=false,flatSleeve=false):{evidence:SetEvidence;look:number[]} {
  const look=crop?setCropLook(crop):[];
  let sd:number|null=null,backDistance:number|null=null;
  if(look.length){
    const means=[0,1,2].map(c=>look.reduce((s,x,i)=>s+(i%3===c?x:0),0)/(W*H));
    sd=255*Math.sqrt(look.reduce((s,x,i)=>s+(x-means[i%3])**2,0)/look.length);
    if(memory.backs.length)backDistance=Math.min(...memory.backs.map(back=>setLookDistance(back,look)));
  }
  // The independent pixel verdict excludes the classifier's detector-only .8/.95 back shortcuts.
  const pixels=crop?classifyFaceState(crop):undefined;
  const matching=backDistance!==null&&backDistance<=SET_BACK_DISTANCE;
  const uniform=sd!==null&&sd<=(flatSleeve?SET_BLIND_SD:SET_UNIFORM_SD)&&sleeveBoundary&&observation.state!=='up';
  // A weak outline plus a marginal texture verdict also describes small screens. One signal must be strong;
  // an accepted sleeve or a near-uniform back with a mat boundary retains its independent path.
  // A still back that kept the same pixel verdict over several clean scans needs only the lower gate, but only with an independent
  // signal (a sleeve clearly unlike the mat around it): steadiness alone also describes a phone or dark art on the mat.
  const pixelConfidence=detector.confidence>=.7||steadyDown&&sleeveBoundary?.8:.9;
  // Texture and a remembered sleeve cannot overrule a detector front: face art can supply both.
  // A nearly uniform sleeve with an independent mat boundary retains its path despite a wrong detector class.
  const positive=(detector.kind==='face-down'||uniform)&&(matching||uniform||!!pixels&&pixels.state==='down'&&pixels.confidence>=pixelConfidence&&sd!==null&&sd<=SET_MAX_SD);
  return {look,evidence:{detector:detector.confidence,pixel:observation.state,pixelConfidence:observation.confidence,sd,backDistance,positive,basis:positive?(matching?'known-back':uniform?'uniform':'pixels'):'none',decision:'waiting'}};
}
export function rememberSetBack(memory:SetCardMemory,look:number[]) {
  if(!look.length||memory.backs.some(b=>setLookDistance(b,look)<=SET_BACK_DISTANCE))return;
  memory.backs.push(look.slice());if(memory.backs.length>32)memory.backs.shift();
}
export const setMatQuad=(card:DetectedQuad,calibration?:FieldCalibration):DetectedQuad=>({...card,quad:card.quad.map(p=>onMat(p,calibration))});
/** Overlap in mat coordinates, with 2% tolerance for camera shake at the boundary. A neighbour is never the same spot. */
export function sameSetRegion(a:DetectedQuad['quad'],b:DetectedQuad['quad']):boolean {
  const card=(quad:DetectedQuad['quad']):DetectedQuad=>({quad,kind:'face-down',confidence:1,partial:false});
  const aa=card(a),bb=card(b),ac=fieldCenter(aa),bc=fieldCenter(bb);
  return quadIou(aa,bb)>=.45||Math.hypot(ac.x-bc.x,ac.y-bc.y)<=.02;
}
export function ignoreSetRegion(memory:SetCardMemory,quad:DetectedQuad['quad'],look:number[],source:SetRegion['source']='player') {
  const old=memory.ignored.find(r=>sameSetRegion(r.quad,quad));
  if(old){old.quad=structuredClone(quad);old.look=look.slice();old.clear=false;old.source=source;old.missingAt=undefined;}
  else memory.ignored.push({quad:structuredClone(quad),look:look.slice(),clear:false,source});
}
/** A plain sleeve the detector cannot see (it scores flat, one-colour backs at nothing): its extent found in the crop of a padded zone cell.
 * The cell sits in the middle of the crop (`pad` of its size on every side). The sleeve is the area around the cell centre within `tolerance`
 * (0..255, max channel) of the centre's median colour, bounded by two clean edges: flat, about one card in size, clear of the crop edge and
 * unlike the ring just outside it. Returns the sleeve rectangle in crop fractions, or undefined (bare mat has no edge, a hand or art is not flat). */
export const BLIND_SLEEVE_TOLERANCE=36,BLIND_SLEEVE_FLAT=.85,BLIND_SLEEVE_RING_GAP=20;
export function findFlatSleeve(crop:RGBAImage,pad:number,tolerance=BLIND_SLEEVE_TOLERANCE):{u0:number;v0:number;u1:number;v1:number}|undefined {
  const {width:w,height:h,data}=crop;if(w<16||h<16)return undefined;
  const px=(x:number,y:number,c:number)=>data[(y*w+x)*4+c];
  const median=(values:number[])=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const centre=[0,1,2].map(c=>{const v:number[]=[];for(let y=Math.floor(h*.4);y<Math.ceil(h*.6);y++)for(let x=Math.floor(w*.4);x<Math.ceil(w*.6);x++)v.push(px(x,y,c));return median(v);});
  const near=(x:number,y:number)=>Math.max(Math.abs(px(x,y,0)-centre[0]),Math.abs(px(x,y,1)-centre[1]),Math.abs(px(x,y,2)-centre[2]))<=tolerance;
  // Extent from the centre outward along the rows/columns of the central band, while most of the line is still the centre colour.
  const band=(line:(i:number)=>number,start:number,count:number,step:number)=>{let i=start;while(i+step>=0&&i+step<count&&line(i+step)>=.6)i+=step;return i;};
  const colShare=(x:number)=>{let n=0,t=0;for(let y=Math.floor(h*.3);y<Math.ceil(h*.7);y++,t++)if(near(x,y))n++;return n/t;};
  const rowShare=(y:number)=>{let n=0,t=0;for(let x=Math.floor(w*.3);x<Math.ceil(w*.7);x++,t++)if(near(x,y))n++;return n/t;};
  const cx=Math.floor(w/2),cy=Math.floor(h/2);
  const x0=band(colShare,cx,w,-1),x1=band(colShare,cx,w,1)+1,y0=band(rowShare,cy,h,-1),y1=band(rowShare,cy,h,1)+1;
  const m=2;if(x0<=m||y0<=m||x1>=w-m||y1>=h-m)return undefined;
  const cell=1/(1+2*pad),rw=(x1-x0)/w/cell,rh=(y1-y0)/h/cell;
  if(rw<.5||rw>1||rh<.6||rh>1)return undefined;
  let inside=0,total=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++,total++)if(near(x,y))inside++;
  if(inside/total<BLIND_SLEEVE_FLAT)return undefined;
  // The ring just outside the edges must be clearly another colour, and mostly not the sleeve's.
  const ring:number[][]=[[],[],[]];let ringNear=0,ringN=0;
  const out=(x:number,y:number)=>{if(x<0||y<0||x>=w||y>=h)return;ringN++;if(near(x,y))ringNear++;for(let c=0;c<3;c++)ring[c].push(px(x,y,c));};
  for(let x=x0;x<x1;x++)for(const d of [3,4,5]){out(x,y0-d);out(x,y1-1+d);}
  for(let y=y0;y<y1;y++)for(const d of [3,4,5]){out(x0-d,y);out(x1-1+d,y);}
  if(!ringN||ringNear/ringN>.3)return undefined;
  const gap=ring.reduce((s,v,c)=>s+Math.abs(median(v)-centre[c]),0)/3;
  if(gap<BLIND_SLEEVE_RING_GAP)return undefined;
  return {u0:x0/w,v0:y0/h,u1:x1/w,v1:y1/h};
}
