import { decide } from './search';
import type { ConfidenceThresholds, RecognitionEvidence, RecognitionTier } from './types';
/** Shared by live decisions and offline calibration; never replay boosted scores. */
export function replayTier(raw: RecognitionEvidence, thresholds: ConfidenceThresholds): RecognitionTier {
  const decision=decide(raw.visual,thresholds,raw.cardBackId);
  if(decision.nothing)return 'low match';
  const winner=raw.visual[0]?.cardId;
  const agree=raw.frames.length>0 && raw.frames.every(f=>f.eligible && f.clean[0]?.cardId===winner && f.ranked[0]?.cardId===winner && decide(f.clean,thresholds,raw.cardBackId).confident);
  return decision.confident && !raw.blocked.length && agree && raw.winnerId===winner ? 'sure' : 'not sure';
}
