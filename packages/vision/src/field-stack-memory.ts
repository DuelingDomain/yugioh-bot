import type { DetectedQuad } from './types';
import type { FieldTrack } from './field-watcher';
import { boundsOf } from './geometry';

const fieldSlot = (zone: string) => /^(M[1-5]|S[1-5]|EMZ[12]|FIELD)$/.test(zone);
const monster = (track: FieldTrack | undefined) => !!track && /^(M[1-5]|EMZ[12])$/.test(track.zone) && !!track.cardId && !track.faceDown;

/** Physical covers, before any missing track is removed. A held outline can never establish a cover. */
export function fieldStackCovers({ tracks, outlines, confirmed, settled, held, empty, exposed = new Set(), at }: {
  tracks: readonly FieldTrack[];
  outlines: ReadonlyMap<string, DetectedQuad>;
  confirmed: ReadonlySet<string>;
  settled: (id: string, card: DetectedQuad) => boolean;
  held: (card: DetectedQuad) => boolean;
  /** The last box now shows its learned empty mat, on a sharp, still frame. */
  empty: (track: FieldTrack) => boolean;
  exposed?: ReadonlySet<string>;
  at: number;
}): { covers: Map<string, string>; waiting: Set<string> } {
  const covers = new Map<string, string>(), waiting = new Set<string>();
  const find = (id: string) => tracks.find(track => track.id === id && !track.removed);
  const tops = tracks.filter(track => {
    const card = outlines.get(track.id);
    return !track.removed && fieldSlot(track.zone) && card && !card.kept && !card.cell && !card.partial &&
      card.confidence >= .7 && !held(card) && settled(track.id, card);
  });
  const over = (bottom: DetectedQuad, top: DetectedQuad) => {
    const a = boundsOf(bottom.quad), b = boundsOf(top.quad), area = a.w * a.h;
    const ratio = b.w * b.h / area, cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    const intersection = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
      Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return ratio > .6 && ratio < 1.7 && intersection / area >= .4 && cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
  };
  const missing = tracks.filter(track => !track.removed && confirmed.has(track.id) && fieldSlot(track.zone) && !outlines.has(track.id));
  for (const bottom of missing) {
    if(exposed.has(bottom.id))continue;
    const top = tops.find(top => {const card=outlines.get(top.id);return card&&top.id!==bottom.id&&top.under!==bottom.id&&over(bottom.card,card);});
    if (top) covers.set(bottom.id, top.id);
  }
  // Preserve bottom-first order through a new top, even when the intermediate card has no outline of its own.
  for (const bottom of missing) {
    const originalTop=bottom.under;let id=originalTop;
    const visited = new Set([bottom.id]);
    while (id && !visited.has(id)) {
      visited.add(id);
      const top = find(id);
      if (!top) break;
      const landing=tracks.some(next=>{
        const card=outlines.get(next.id);
        return next.id!==bottom.id&&next.id!==top.id&&next.state==='candidate'&&at-next.firstSeen<=1500&&
          card&&!card.kept&&!card.cell&&!card.partial&&card.confidence>=.7&&!held(card)&&over(top.card,card);
      });
      if (originalTop&&(tops.includes(top)||held(top.card)||landing)) { covers.set(bottom.id,originalTop); break; }
      id = covers.get(id) ?? top.under;
    }
  }
  // Keep an empty source through the receiving outline's short rest check. This does not declare a cover
  // and cannot retain an absent card beyond the bounded landing check.
  const landings = tracks.filter(top => {
    const card = outlines.get(top.id);
    return card && !top.removed && !card.kept && !card.cell && !card.partial && card.confidence >= .7 &&
      fieldSlot(top.zone) && at - top.firstSeen <= 1500 && !held(card) &&
      missing.some(bottom => bottom.id !== top.id && monster(bottom) && over(bottom.card, card));
  });
  if (landings.length === 1) {
    const card = outlines.get(landings[0].id);
    const sources = missing.filter(source => monster(source) && !covers.has(source.id) && card &&
      !over(source.card, card) && at - source.lastSeen <= 5000 && empty(source));
    if (sources.length === 1) waiting.add(sources[0].id);
  }
  // Two occupied spots became one changed outline plus empty mat. With exactly one missing monster and one
  // receiving stack, the stationary card is bottom, the incoming card is next, and the new outline is top.
  const moved = missing.filter(track => !exposed.has(track.id) && monster(track) && !covers.has(track.id) && at - track.lastSeen <= 5000 && empty(track));
  if (moved.length === 1) {
    const source = moved[0];
    const receivers = tops.filter(top => top.id !== source.id && at - top.firstSeen <= 5000 &&
      [...covers].some(([id, cover]) => cover === top.id && monster(find(id))));
    if (receivers.length === 1) {
      const top = receivers[0];
      const bottom = missing.find(track => covers.get(track.id) === top.id && monster(track));
      if (bottom) { covers.set(bottom.id, source.id); covers.set(source.id, top.id); }
    }
  }
  return { covers, waiting };
}

/** Whole physical stack, bottom first. Cycles and repeated refs are ignored. */
export function fieldStackUnder(id: string, tracks: readonly Pick<FieldTrack, 'id' | 'under' | 'removed'>[]): string[] {
  const result: string[] = [], visited = new Set([id]);
  const visit = (top: string) => {
    for (const track of tracks) if (!track.removed && track.under === top && !visited.has(track.id)) {
      visited.add(track.id); visit(track.id); result.push(track.id);
    }
  };
  visit(id);
  return result;
}
