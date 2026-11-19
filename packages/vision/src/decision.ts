import { decide, deckConfidenceThresholds, closedConfidenceThresholds } from './search';
import type { Candidate, ConfidenceThresholds, RecognitionEvidence, RecognitionTier } from './types';

/** A near-tie in the catalog can be broken by a much wider lead in the registered deck. */
export function deckRescueWinner(raw:RecognitionEvidence, thresholds:ConfidenceThresholds):Candidate|undefined {
  if(!raw.deckRescue?.length||!raw.priors?.decklist?.length||raw.blocked.length||!raw.frames.length)return;
  const deck=new Set(raw.priors.decklist);
  const wins=(list:Candidate[],visual:Candidate[])=>{
    const [best,next]=list.filter(c=>deck.has(c.cardId)||c.cardId===raw.cardBackId), open=visual[0];
    if(!best||!next||!open||best.cardId===raw.cardBackId||open.cardId===raw.cardBackId)return;
    if(best.score<Math.max(.70,thresholds.floor-.04)||best.score-next.score<Math.max(.12,thresholds.margin))return;
    if(open.cardId!==best.cardId&&(open.score-best.score>.025||decide(visual,thresholds,raw.cardBackId).confident))return;
    return best;
  };
  const best=wins(raw.deckRescue,raw.visual);
  if(best&&raw.frames.every(f=>f.eligible&&!f.faceDown&&wins(f.deck,f.clean)?.cardId===best.cardId))return best;
}
/** Shared by live decisions and offline calibration; never replay boosted scores. */
export function replayTier(raw: RecognitionEvidence, thresholds: ConfidenceThresholds): RecognitionTier {
  if(raw.winnerId&&deckRescueWinner(raw,thresholds)?.cardId===raw.winnerId)return 'sure';
  const decision=decide(raw.visual,thresholds,raw.cardBackId);
  if(decision.nothing)return 'low match';
  const winner=raw.visual[0]?.cardId;
  const agrees=(limits:ConfidenceThresholds)=>raw.frames.length>0 && raw.frames.every(f=>f.eligible && f.clean[0]?.cardId===winner && f.ranked[0]?.cardId===winner && decide(f.clean,limits,raw.cardBackId).confident);
  const catalogSure=decision.confident && agrees(thresholds);
  // Deck suggestions never supply the runner-up margin: use the unboosted
  // catalog winner and every clean frame, and require the ranked winner to agree.
  const deckLimits=deckConfidenceThresholds(thresholds);
  const deckSure=winner!==raw.cardBackId && Boolean(winner && raw.priors?.decklist?.includes(winner)) && decide(raw.visual,deckLimits,raw.cardBackId).confident && agrees(deckLimits);
  // A closed-set answer already passed its accept bar and the open-catalog check inside the pipeline.
  const closedLimits=closedConfidenceThresholds(thresholds,raw.closedSet);
  const closedSure=raw.closedSet!==undefined && winner!==raw.cardBackId && decide(raw.visual,closedLimits,raw.cardBackId).confident && agrees(closedLimits);
  return (catalogSure || deckSure || closedSure) && !raw.blocked.length && raw.winnerId===winner ? 'sure' : 'not sure';
}
