import { detect, refinedCorners } from './detector/run';
import { CARD_DETECTOR } from './detector/spec';
import { isCovered } from './board';
import type { ModelSession } from './runtime';
import type { TensorCtor } from './embed';
import type { RGBAImage } from './pixels';
import type { DetectedQuad, GameProfile } from './types';
/** Detector only: no index, embedding session or learned-reference requests. */
export async function detectScene(frame:RGBAImage,profile:GameProfile,detector:ModelSession,Tensor:TensorCtor):Promise<DetectedQuad[]> {
    if(frame.width<3 || frame.height<3 || frame.width*frame.height>16_000_000 || frame.data.length!==frame.width*frame.height*4) throw new Error('Invalid frame');
    const cards=await detect(detector,Tensor,frame,profile.detector.longSide,CARD_DETECTOR.minScore);
    const quads=cards.map(card=>{const quad=refinedCorners(card,frame);return {quad:quad.map(p=>({x:p.x/frame.width,y:p.y/frame.height})),kind:card.kind,confidence:card.conf,partial:quad.some(p=>p.x<0 || p.y<0 || p.x>frame.width || p.y>frame.height)};}).filter(c=>c.quad.length===4);
    return quads.filter(c=>c.confidence>=CARD_DETECTOR.minConfidence).map(c=>({...c,covered:isCovered(c,quads)})).sort((a,b)=>{const ay=Math.min(...a.quad.map(p=>p.y)),by=Math.min(...b.quad.map(p=>p.y));return Math.abs(ay-by)>.04?ay-by:Math.min(...a.quad.map(p=>p.x))-Math.min(...b.quad.map(p=>p.x));});
}
