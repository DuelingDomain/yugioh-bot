import { detect, refinedCorners } from './detector/run';
import { CARD_DETECTOR } from './detector/spec';
import { isCovered } from './board';
import type { ModelSession } from './runtime';
import type { TensorCtor } from './embed';
import type { RGBAImage } from './pixels';
import { cropRGBA } from './pixels';
import { validateOptions } from './options';
import type { DetectedQuad, GameProfile, RecognizeOptions } from './types';
/** Detector only: no index, embedding session or learned-reference requests. */
export async function detectScene(frame:RGBAImage,profile:GameProfile,detector:ModelSession,Tensor:TensorCtor,opts:Pick<RecognizeOptions,'region'>={}):Promise<DetectedQuad[]> {
    if(frame.width<3 || frame.height<3 || frame.width*frame.height>16_000_000 || frame.data.length!==frame.width*frame.height*4) throw new Error('Invalid frame');
    validateOptions(opts);
    const region=opts.region,x=region?Math.floor(region.x*frame.width):0,y=region?Math.floor(region.y*frame.height):0;
    const input=region?cropRGBA(frame,x,y,Math.max(3,Math.ceil(region.w*frame.width)),Math.max(3,Math.ceil(region.h*frame.height))):frame;
    const cards=(await detect(detector,Tensor,input,region?448:profile.detector.longSide,CARD_DETECTOR.minScore,!!region)).map(card=>region?{...card,cx:card.cx+x,cy:card.cy+y,pts:card.pts.map(([px,py])=>[px+x,py+y] as [number,number])}:card);
    const quads=cards.map(card=>{const quad=refinedCorners(card,frame);return {quad:quad.map(p=>({x:p.x/frame.width,y:p.y/frame.height})),kind:card.kind,confidence:card.conf,partial:quad.some(p=>p.x<0 || p.y<0 || p.x>frame.width || p.y>frame.height)||!!region&&card.pts.some(([px,py])=>px<=x+2||py<=y+2||px>=x+input.width-2||py>=y+input.height-2)};}).filter(c=>c.quad.length===4);
    return quads.filter(c=>c.confidence>=CARD_DETECTOR.minConfidence).map(c=>({...c,covered:isCovered(c,quads)})).sort((a,b)=>{const ay=Math.min(...a.quad.map(p=>p.y)),by=Math.min(...b.quad.map(p=>p.y));return Math.abs(ay-by)>.04?ay-by:Math.min(...a.quad.map(p=>p.x))-Math.min(...b.quad.map(p=>p.x));});
}
