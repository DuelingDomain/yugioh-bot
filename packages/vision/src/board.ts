// Adapted from Duel Lens src/content/board.ts and src/offscreen/engine.ts (Apache-2.0), f6968f3.
// Modified: normalized source quads, generic IDs, conservative selected-outline overlap guard.
// See licenses/duel-lens.LICENSE. No extension storage or transport.
import { boundsOf, iou, insideShare, clipToConvex, polygonArea } from './geometry';
import { validateOptions } from './options';
import type { BoardSide, DetectedQuad } from './types';
export const MAX_BOARD = 60;
export const COVERED = { minFit: .6, lead: .2, maxPickInside: .8 } as const;
export function boardSide(centerY: number): BoardSide { return centerY > .5 ? 'near' : 'far'; }
/** Upstream bounds-fit rule: a competing detection fits the requested target much better than the pick. */
export function coveredBy(pick: DetectedQuad, weak: DetectedQuad[], target: DetectedQuad): boolean {
  if(pick.kind==='face-down') return false;
  const bounds=boundsOf(pick.quad), user=boundsOf(target.quad), pickFit=iou(bounds,user);
  return weak.some(w=>w.kind==='face-up' && iou(boundsOf(w.quad),user)>=COVERED.minFit &&
    iou(boundsOf(w.quad),user)-pickFit>=COVERED.lead && insideShare(bounds,boundsOf(w.quad))<=COVERED.maxPickInside);
}
/** No depth information: conservatively suppress both distinct overlapping outlines, including weak detections. */
export function isCovered(target: DetectedQuad, cards: DetectedQuad[]): boolean {
  const area=polygonArea(target.quad);
  if(area<=0) return false;
  return cards.some(other=>{
    const intersection=polygonArea(clipToConvex(target.quad,other.quad));
    const union=area+polygonArea(other.quad)-intersection;
    return union>0 && intersection>0 && intersection/union<.8 &&
      (coveredBy(other,[target],target) || intersection/area>=.2);
  });
}
export function validateBoard(cards: DetectedQuad[]): void {
  if(!Array.isArray(cards) || cards.length>MAX_BOARD) throw new Error('Supply at most 60 card outlines');
  for(const card of cards) validateOptions({card});
}
