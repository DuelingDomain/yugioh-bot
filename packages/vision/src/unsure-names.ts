import type {RecognitionResult} from './types';

/** Local replay operating point; not a calibrated probability. See docs/remote-duels/unsure-names.md. */
export const UNSURE_NAME_MARGIN=.115;
export function unsureNameCandidates(result:RecognitionResult,backId:string) {
  if(result.quality.faceDown||result.quality.fallback||result.quality.partial||result.quality.covered)return;
  const candidates=result.raw?.visual??result.candidates;
  const distinct=[...new Map(candidates.map(c=>[c.cardId,c])).values()].sort((a,b)=>b.score-a.score);
  const [top,second]=distinct;
  if(!top||!second||top.cardId===backId||top.cardId!==result.candidates[0]?.cardId||top.score<.60||top.score-second.score<UNSURE_NAME_MARGIN)return;
  if(distinct.slice(0,3).some(c=>c.cardId===backId))return;
  return distinct.slice(0,3).map(({cardId,score})=>({cardId,score}));
}
