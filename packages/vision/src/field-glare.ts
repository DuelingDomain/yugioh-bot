import type { FieldTrack } from './field-watcher';
import type { RGBAImage } from './pixels';
import { GLARE_ALWAYS_TRY, glareMask } from './preclean';
import { mergeCandidates } from './search';
import type { Candidate, RecognitionResult } from './types';

export type FieldGlareSample = { at: number; share: number };
export type FieldGlareNotice = { share: number; candidates: Candidate[] };

export function sampleFieldGlare(crop: RGBAImage, at: number): FieldGlareSample | undefined {
  const { share } = glareMask(crop);
  if (share >= GLARE_ALWAYS_TRY) return { at, share };
}

export function fieldGlareNotice(track: FieldTrack, sample: FieldGlareSample, at: number, candidates: Candidate[] = []): FieldGlareNotice | undefined {
  if (at - sample.at > 1250 || track.restSince === undefined || at - track.restSince <= 2000 ||
    track.faceDown || track.pixelsDown || track.cardId || track.removed || track.under || track.state === 'dismissed' ||
    track.card.kind !== 'face-up' || track.card.kept || track.card.covered || track.card.partial) return;
  return { share: sample.share, candidates: track.visible || track.state === 'candidate' ? candidates : [] };
}

export function fieldGlareChoices(result?: RecognitionResult): Candidate[] {
  const raw = result?.raw;
  if (!result || !raw?.priors?.decklist?.length || result.quality.covered || result.quality.partial || result.quality.fallback || result.quality.faceDown) return [];
  const deck = new Set(raw.priors.decklist);
  const lists = [raw.visual, ...raw.frames.filter(frame => frame.eligible).map(frame => frame.deck)];
  return mergeCandidates(lists.map(list => list.filter(c => c.cardId !== raw.cardBackId && deck.has(c.cardId) && c.score >= .55)), 3);
}
