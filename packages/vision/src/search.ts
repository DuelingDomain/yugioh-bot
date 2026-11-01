// Cosine search adapted from Duel Lens src/shared/search.ts (Apache-2.0).
// Modified: game-neutral ids, priors, renormalized quantized vectors, border hint.
// See licenses/duel-lens.LICENSE.
import type { Candidate, LoadedIndex, RecognitionPriors, ConfidenceThresholds, RecognitionTier } from './types';
export function normalize(v: Float32Array): Float32Array {
  const norm = Math.hypot(...v);
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Invalid embedding');
  return Float32Array.from(v, x => x / norm);
}
export function topK(query: Float32Array, index: LoadedIndex, k = 5, priors?: RecognitionPriors, frameClass?: string, cardIds?: ReadonlySet<string>): Candidate[] {
  const { dim, count, entries } = index.meta;
  if (query.length !== dim || !query.every(Number.isFinite)) throw new Error('Embedding dimension/value mismatch');
  const seen = new Set(priors?.seen), voice = new Set(priors?.voiceMentioned);
  const filter = priors?.frameClasses?.length ? new Set(priors.frameClasses) : null;
  const best = new Map<string, Candidate & { rank: number }>();
  for (let row = 0; row < count; row++) {
    const entry = entries[row];
    if (cardIds && !cardIds.has(entry.cardId)) continue;
    if (filter && !filter.has(entry.frameClass ?? '')) continue;
    let dot = 0, norm = 0;
    for (let d = 0; d < dim; d++) { const v = index.vectors[row * dim + d]; dot += query[d] * v; norm += v * v; }
    if (!norm) continue;
    const raw = Math.max(-1, Math.min(1, dot / Math.sqrt(norm)));
    // Priors only reorder plausible visual matches; scores are ranking similarities, not probabilities.
    const boost = raw >= 0.5 ? Math.min(0.06, (seen.has(entry.cardId) ? 0.015 : 0) + (voice.has(entry.cardId) ? 0.04 : 0)) : 0;
    // Border is unreliable under glare: a soft class filter never empties the candidate list.
    const penalty = frameClass && entry.frameClass && frameClass !== entry.frameClass ? 0.035 : 0;
    const rank = raw + boost - penalty;
    const score = Math.max(-1, Math.min(1, rank));
    if (rank > (best.get(entry.cardId)?.rank ?? -Infinity)) best.set(entry.cardId, { cardId: entry.cardId, score, rank });
  }
  return [...best.values()].sort((a, b) => b.rank - a.rank).slice(0, Math.max(1, Math.min(100, Math.floor(k)))).map(({ cardId, score }) => ({ cardId, score }));
}

/** Deck suggestions win ambiguous reads; a clear catalog answer always wins.
 * Confidence is still checked against the unboosted full catalog by the pipeline.
 */
export function preferDeck(deck: Candidate[], catalog: Candidate[], thresholds: ConfidenceThresholds): Candidate[] {
  if (!decide(deck, thresholds).confident || decide(catalog, thresholds).confident) return catalog;
  const first = deck[0];
  if (first.score < (catalog[0]?.score ?? 0) - thresholds.margin) return catalog;
  return [first, ...catalog.filter(c => c.cardId !== first.cardId)];
}

/** Merge candidate lists from several crop hypotheses: max score per card. */
export function mergeCandidates(lists: Candidate[][], k: number): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const list of lists) {
    for (const c of list) {
      const prev = best.get(c.cardId);
      if (!prev || c.score > prev.score) best.set(c.cardId, c);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
}

/**
 * confident: top score clears `score` and beats the next card by `margin`.
 * nothing: no candidate, or the top score is below `floor`.
 */
export function decide(
  candidates: Candidate[],
  t: ConfidenceThresholds,
  cardBackId?: string,
): { confident: boolean; nothing: boolean } {
  const s1 = candidates[0]?.score ?? -Infinity;
  if (!(s1 >= t.floor)) return { confident: false, nothing: true };
  const lead = s1 - (candidates[1]?.score ?? 0);
  let confident = (s1 >= t.score && lead >= t.margin) || (t.second !== undefined && s1 >= t.second.score && lead >= t.second.margin);
  // The card back looks like no card, so a real one wins by a wide margin; a narrow win is
  // something dark and patterned (an empty mat zone), not a face-down card.
  if (confident && candidates[0].cardId === cardBackId && t.cardBackMargin !== undefined && lead < t.cardBackMargin) confident = false;
  return { confident, nothing: false };
}

/** Fallback guesses remain suggestions even when their visual similarity is high. */
export function tierFor(candidates: Candidate[], thresholds: ConfidenceThresholds, fallback = false, cardBackId?: string, unambiguousViews = true): RecognitionTier {
  const decision = decide(candidates, thresholds, cardBackId);
  return decision.nothing ? 'low match' : decision.confident && !fallback && unambiguousViews ? 'sure' : 'not sure';
}
