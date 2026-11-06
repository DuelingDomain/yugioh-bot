import { catalogCardId } from './physical-index';
import type { IndexEntry, RecognitionResult, RecognitionTier } from './types';
export interface RemoteRecognitionResult {
  type:'recognition.result';requestId:string;
  candidates:{cardId:number;name:string;score:number}[];
  tier:RecognitionTier;faceDown:boolean;covered:boolean;
}
/** The remote wire payload carries certainty and safe catalog IDs, never pixels. */
export function toRemoteRecognitionResult(result:RecognitionResult,entries:ReadonlyMap<string,IndexEntry>,requestId:string):RemoteRecognitionResult {
  if(!requestId.length || requestId.length>100)throw new Error('Invalid request ID');
  const faceDown=Boolean(result.quality.faceDown || result.detectedCard?.kind==='face-down');
  const candidates=faceDown?[]:result.candidates.flatMap(c=>{
    const entry=entries.get(c.cardId),cardId=catalogCardId(entry);
    return cardId && entry && Number.isFinite(c.score)?[{cardId,name:entry.name,score:Math.max(0,Math.min(1,c.score))}]:[];
  }).slice(0,5);
  return {type:'recognition.result',requestId,candidates,tier:result.tier,faceDown,covered:Boolean(result.quality.covered)};
}
