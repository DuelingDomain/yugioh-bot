import {classifyFaceState, type FaceStateResult} from './face-state';
import type {RGBAImage} from './pixels';
import type {DetectedQuad} from './types';
import {fieldCenter, onMat, quadIou, type FieldCalibration} from './field-zones';

export const DEFAULT_SET_GUARDS = {positiveBack:true, prompt:true, ignore:true, startup:true};
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
export const SET_MAX_SD=40,SET_UNIFORM_SD=8,SET_BACK_DISTANCE=.035;
export function measureSetEvidence(crop:RGBAImage|undefined,detector:number,observation:FaceStateResult,memory:SetCardMemory,sleeveBoundary=false):{evidence:SetEvidence;look:number[]} {
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
  const uniform=sd!==null&&sd<=SET_UNIFORM_SD&&sleeveBoundary&&observation.state!=='up';
  const positive=matching||uniform||!!pixels&&pixels.state==='down'&&pixels.confidence>=.8&&sd!==null&&sd<=SET_MAX_SD;
  return {look,evidence:{detector,pixel:observation.state,pixelConfidence:observation.confidence,sd,backDistance,positive,basis:matching?'known-back':uniform?'uniform':positive?'pixels':'none',decision:'waiting'}};
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
