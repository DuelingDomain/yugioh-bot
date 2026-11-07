import type { ScenePixelSource } from './scene-pixels';
import type { SceneRefiner } from './scene-refiner';
import { detect, refinedCorners } from './detector/run';
import { CARD_DETECTOR } from './detector/spec';
import { isCovered } from './board';
import type { ModelSession } from './runtime';
import type { TensorCtor } from './embed';
import type { RGBAImage } from './pixels';
import { cropRGBA } from './pixels';
import { validateOptions } from './options';
import type { DetectedQuad, DetectOptions, GameProfile, Point } from './types';
import { boundsOf } from './geometry';
import { darkShare, shadowLift } from './preclean';
/** Low-score outlines over a known card stay down to this score (hysteresis); they never start a new card. */
export const KEEP_MIN_CONFIDENCE=.25;
/** A frame with this much dark region (or dim overall) also runs the shadow-lifted pass for known cards. */
export const SHADOW_PASS_SHARE=.15;
let shadowPasses=0;
/** Profile only: 1 when the last detectScene() also ran the shadow-lifted pass. */
export const lastShadowPasses=()=>shadowPasses;
const overlap=(a:Point[],b:Point[])=>{const p=boundsOf(a),q=boundsOf(b);return Math.max(0,Math.min(p.x+p.w,q.x+q.w)-Math.max(p.x,q.x))*Math.max(0,Math.min(p.y+p.h,q.y+q.h)-Math.max(p.y,q.y))/Math.max(1e-9,Math.min(p.w*p.h,q.w*q.h));};
/** Detector only: no index, embedding session or learned-reference requests. */
export async function detectScene(frame:RGBAImage,profile:GameProfile,detector:ModelSession,Tensor:TensorCtor,opts:DetectOptions={},refiner?:SceneRefiner,pixels?:ScenePixelSource):Promise<DetectedQuad[]> {
    if(frame.width<3 || frame.height<3 || frame.width*frame.height>16_000_000 || frame.data.length!==frame.width*frame.height*4) throw new Error('Invalid frame');
    validateOptions({region:opts.region});
    const keep=(opts.keep??[]).filter(q=>q.length===4&&q.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
    const piles=(opts.piles??[]).filter(q=>q.length===4&&q.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
    const cells=(opts.cells??[]).filter(q=>q.length===4&&q.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
    const width=pixels?.width??frame.width,height=pixels?.height??frame.height;
    refiner?.begin(width,height);
    const qualifies=(c:DetectedQuad)=>c.confidence>=CARD_DETECTOR.minConfidence||
      c.confidence>=KEEP_MIN_CONFIDENCE&&keep.some(q=>overlap(c.quad,q)>0)||
      piles.some(q=>overlap(c.quad,q)>0)||c.kind==='face-down'&&cells.some(q=>overlap(c.quad,q)>0);
    const pass=async(source:RGBAImage,region=opts.region,lift=false)=>{
      const x=region?Math.floor(region.x*width):0,y=region?Math.floor(region.y*height):0;
      const w=region?Math.min(width-x,Math.max(3,Math.ceil(region.w*width))):width,h=region?Math.min(height-y,Math.max(3,Math.ceil(region.h*height))):height;
      let input=region?(pixels?.sample(region,448)??cropRGBA(source,x,y,w,h)):source;
      if(lift)input=shadowLift(input);
      const sx=w/input.width,sy=h/input.height;
      const cards=(await detect(detector,Tensor,input,region?448:profile.detector.longSide,CARD_DETECTOR.minScore,!!region)).map(card=>({...card,cx:card.cx*sx+x,cy:card.cy*sy+y,w:card.w*(sx+sy)/2,h:card.h*(sx+sy)/2,pts:card.pts.map(([px,py])=>[px*sx+x,py*sy+y] as [number,number])}));
      return cards.map(card=>{
        // Rejected decode-floor boxes still contribute to the covered guard, without edge fitting.
        const raw={quad:card.pts.map(([x,y])=>({x:x/width,y:y/height})),kind:card.kind,confidence:card.conf,partial:false};
        // Use the entire possible edge-search footprint here. Exact overlap admission follows the fit.
        const radius=Math.hypot(card.w,card.h)/2+Math.max(card.w,card.h)*.2+3;
        const search={...raw,quad:[{x:(card.cx-radius)/width,y:(card.cy-radius)/height},{x:(card.cx+radius)/width,y:(card.cy-radius)/height},{x:(card.cx+radius)/width,y:(card.cy+radius)/height},{x:(card.cx-radius)/width,y:(card.cy+radius)/height}]};
        const quad=qualifies(search)?(refiner?.refine(card,source,pixels?(c)=>pixels.refine(c):undefined)??(pixels?pixels.refine(card):refinedCorners(card,source))):card.pts.map(([x,y])=>({x,y}));return {quad:quad.map(p=>({x:p.x/width,y:p.y/height})),kind:card.kind,confidence:card.conf,partial:quad.some(p=>p.x<0 || p.y<0 || p.x>width || p.y>height)||!!region&&card.pts.some(([px,py])=>px<=x+2||py<=y+2||px>=x+w-2||py>=y+h-2)} as DetectedQuad;}).filter(c=>c.quad.length===4);
    };
    shadowPasses=0;
    const quads=await pass(frame);
    const known=(c:DetectedQuad)=>keep.some(q=>overlap(c.quad,q)>=.6),inPile=(c:DetectedQuad)=>piles.some(q=>overlap(c.quad,q)>=.6),inCell=(c:DetectedQuad)=>c.kind==='face-down'&&cells.some(q=>overlap(c.quad,q)>=.6);
    // Hysteresis: a card already on the field keeps a weaker outline (a shadow lowers the score).
    // A Deck/Extra cell returns every decoded outline (score >= minScore) flagged `pile`: the
    // watcher uses it from CARD_DETECTOR.pileMinConfidence and shows the best score in the Debug line.
    // A face-down outline in a calibrated field cell is returned from the decode floor, flagged `cell`: light
    // (white) sleeves on a dark mat score .3-.45, below minConfidence (the model trained on digital backs).
    const result=quads.flatMap(c=>c.confidence>=CARD_DETECTOR.minConfidence?[c]:c.confidence>=KEEP_MIN_CONFIDENCE&&known(c)?[Object.assign(c,{kept:true})]:inPile(c)?[Object.assign(c,{kept:true,pile:true})]:inCell(c)?[Object.assign(c,{cell:true})]:[]),scene=[...quads];
    // A big dark region (a player's shadow, or a shadow from above): one more pass on the
    // shadow-lifted frame, only for known cards that the normal pass lost.
    const lost=(opts.shadowKeep??keep).filter(q=>q.length===4&&q.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))&&!result.some(c=>overlap(c.quad,q)>=.6));
    if(opts.shadowPass!==false&&lost.length&&darkShare(frame)>=SHADOW_PASS_SHARE){
      shadowPasses=1;
      const boxes=lost.map(boundsOf);
      const left=Math.max(0,Math.min(...boxes.map(b=>b.x-b.w*.2))-.02),top=Math.max(0,Math.min(...boxes.map(b=>b.y-b.h*.2))-.02);
      const right=Math.min(1,Math.max(...boxes.map(b=>b.x+b.w*1.2))+.02),bottom=Math.min(1,Math.max(...boxes.map(b=>b.y+b.h*1.2))+.02);
      const lifted=right>left&&bottom>top?await pass(frame,{x:left,y:top,w:right-left,h:bottom-top},true):[];
      for(const c of lifted)if(c.confidence>=KEEP_MIN_CONFIDENCE&&lost.some(q=>overlap(c.quad,q)>=.6)&&!result.some(r=>overlap(r.quad,c.quad)>=.5)){const held=Object.assign(c,{kept:true});result.push(held);scene.push(held);}
    }
    return result.map(c=>({...c,covered:isCovered(c,scene)})).sort((a,b)=>{const ay=Math.min(...a.quad.map(p=>p.y)),by=Math.min(...b.quad.map(p=>p.y));return Math.abs(ay-by)>.04?ay-by:Math.min(...a.quad.map(p=>p.x))-Math.min(...b.quad.map(p=>p.x));});
}
