// Cosine search adapted from Duel Lens src/shared/search.ts (Apache-2.0).
// Modified: game-neutral ids, priors, renormalized quantized vectors, border hint.
// See licenses/duel-lens.LICENSE.
import type { Candidate, LoadedIndex, RecognitionPriors, ConfidenceThresholds, RecognitionTier } from './types';
export function normalize(v: Float32Array): Float32Array {
  const norm = Math.hypot(...v);
  if (!Number.isFinite(norm) || norm === 0) throw new Error('Invalid embedding');
  return Float32Array.from(v, x => x / norm);
}
interface SearchData { inverseNorms:Float64Array; rowsByCard:Map<string,number[]>; order:Map<string,number> }
const prepared=new WeakMap<LoadedIndex,SearchData>();
/** Immutable loaded indexes live for the worker lifetime; norms never depend on a query. */
export function prepareSearch(index:LoadedIndex):SearchData {
  const cached=prepared.get(index);if(cached)return cached;
  const {count,dim,entries}=index.meta,vectors=index.vectors;
  const inverseNorms=new Float64Array(count),rowsByCard=new Map<string,number[]>(),order=new Map<string,number>();
  for(let row=0;row<count;row++) {
    let norm=0;for(let d=row*dim,end=d+dim;d<end;d++)norm+=vectors[d]*vectors[d];
    inverseNorms[row]=norm?1/Math.sqrt(norm):0;
    const id=entries[row].cardId,rows=rowsByCard.get(id);
    if(rows)rows.push(row);else {order.set(id,order.size);rowsByCard.set(id,[row]);}
  }
  const value={inverseNorms,rowsByCard,order};prepared.set(index,value);return value;
}
export function topK(query: Float32Array, index: LoadedIndex, k = 5, priors?: RecognitionPriors, frameClass?: string, cardIds?: ReadonlySet<string>): Candidate[] {
  const { dim, count, entries } = index.meta;
  if (query.length !== dim || !query.every(Number.isFinite)) throw new Error('Embedding dimension/value mismatch');
  const {inverseNorms,rowsByCard,order}=prepareSearch(index),vectors=index.vectors;
  const limit=Math.max(1,Math.min(100,Math.floor(k)));
  const seen = new Set(priors?.seen), voice = new Set(priors?.voiceMentioned);
  const filter = priors?.frameClasses?.length ? new Set(priors.frameClasses) : null;
  const rows=cardIds?Array.from(cardIds).flatMap(id=>rowsByCard.get(id)??[]):undefined;
  const best:(Candidate & {rank:number;order:number})[]=[];
  for (let r = 0; r < (rows?.length??count); r++) {
    const row=rows?rows[r]:r;
    const entry = entries[row];
    if (filter && !filter.has(entry.frameClass ?? '')) continue;
    const inverse=inverseNorms[row];if(!inverse)continue;
    let a=0,b=0,c=0,d=0,j=0,offset=row*dim;
    // Flat int8/float32 dot product: no row slices, allocations or per-query norms.
    for(;j+3<dim;j+=4,offset+=4){a+=query[j]*vectors[offset];b+=query[j+1]*vectors[offset+1];c+=query[j+2]*vectors[offset+2];d+=query[j+3]*vectors[offset+3];}
    let dot=a+b+c+d;for(;j<dim;j++,offset++)dot+=query[j]*vectors[offset];
    const raw = Math.max(-1, Math.min(1, dot * inverse));
    // Priors only reorder plausible visual matches; scores are ranking similarities, not probabilities.
    const boost = raw >= 0.5 ? Math.min(0.06, (seen.size&&seen.has(entry.cardId) ? 0.015 : 0) + (voice.size&&voice.has(entry.cardId) ? 0.04 : 0)) : 0;
    // Border is unreliable under glare: a soft class filter never empties the candidate list.
    const penalty = frameClass && entry.frameClass && frameClass !== entry.frameClass ? 0.035 : 0;
    const rank = raw + boost - penalty;
    const score = Math.max(-1, Math.min(1, rank));
    const last=best[limit-1];
    if(last&&rank<last.rank)continue;
    const ordinal=order.get(entry.cardId)!;
    if(last&&(rank<last.rank||(rank===last.rank&&ordinal>=last.order)))continue;
    const existing=best.findIndex(c=>c.cardId===entry.cardId);
    if(existing>=0){if(rank<=best[existing].rank)continue;best.splice(existing,1);}
    const at=best.findIndex(c=>rank>c.rank||(rank===c.rank&&ordinal<c.order));
    best.splice(at<0?best.length:at,0,{cardId:entry.cardId,score,rank,order:ordinal});
    if(best.length>limit)best.pop();
  }
  return best.map(({cardId,score})=>({cardId,score}));
}

/** Deck suggestions win ambiguous reads; a clear catalog answer always wins.
 * Confidence is still checked against the unboosted full catalog by the pipeline.
 */
export function preferDeck(deck: Candidate[], catalog: Candidate[], thresholds: ConfidenceThresholds, cleanCatalog:Candidate[]=catalog): Candidate[] {
  if(decide(cleanCatalog,thresholds).confident) {
    const winner=catalog.find(c=>c.cardId===cleanCatalog[0]?.cardId);
    return winner?[winner,...catalog.filter(c=>c.cardId!==winner.cardId)]:catalog;
  }
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
