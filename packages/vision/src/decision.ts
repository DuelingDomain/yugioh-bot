import { decide, deckConfidenceThresholds } from './search';
import type { ConfidenceThresholds, RecognitionEvidence, RecognitionTier } from './types';
/** Shared by live decisions and offline calibration; never replay boosted scores. */
export function replayTier(raw: RecognitionEvidence, thresholds: ConfidenceThresholds): RecognitionTier {
  const decision=decide(raw.visual,thresholds,raw.cardBackId);
  if(decision.nothing)return 'low match';
  const winner=raw.visual[0]?.cardId;
  const agrees=(limits:ConfidenceThresholds)=>raw.frames.length>0 && raw.frames.every(f=>f.eligible && f.clean[0]?.cardId===winner && f.ranked[0]?.cardId===winner && decide(f.clean,limits,raw.cardBackId).confident);
  const catalogSure=decision.confident && agrees(thresholds);
  // Deck suggestions never supply the runner-up margin: use the unboosted
  // catalog winner and every clean frame, and require the ranked winner to agree.
  const deckLimits=deckConfidenceThresholds(thresholds);
  const deckSure=winner!==raw.cardBackId && Boolean(winner && raw.priors?.decklist?.includes(winner)) && decide(raw.visual,deckLimits,raw.cardBackId).confident && agrees(deckLimits);
  return (catalogSure || deckSure) && !raw.blocked.length && raw.winnerId===winner ? 'sure' : 'not sure';
}
