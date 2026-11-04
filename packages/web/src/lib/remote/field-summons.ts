import type { RemoteSummonKind, TwinCard } from '@yugidraft/shared/remote';
import type { FieldZoneFacts } from './field-legality';

/** A monster that left its zone (camera "removed"), in watcher time (track.lastSeen). */
export type FieldVanish = { ref: string; at: number };
/** Summon window: materials that went under the card or left the field up to 5 s before its first outline (or after its placement). */
export const SUMMON_WINDOW_MS = 5000;
const MONSTER_ZONES = new Set(['monster', 'extra-monster']);

/** Xyz / Synchro / Link / Fusion from the catalog type line, else undefined. Link rating is `level` for Link Monsters. */
export function fieldSummonKind(facts: FieldZoneFacts | undefined): { kind: RemoteSummonKind; rating?: number } | undefined {
  const type = facts?.type ?? '';
  if (!/\bmonster\b/i.test(type)) return;
  if (/\bxyz\b/i.test(type)) return { kind: 'xyz' };
  if (/\bsynchro\b/i.test(type)) return { kind: 'synchro' };
  // A Link Monster with no known rating is not a camera summon (no limit to trust).
  if (/\blink\b/i.test(type) || facts?.frameType === 'link') return facts?.level ? { kind: 'link', rating: facts.level } : undefined;
  if (/\bfusion\b/i.test(type)) return { kind: 'fusion' };
}

/** The fewest materials the camera needs to call it a summon. */
export const fieldSummonMinimum = (kind: RemoteSummonKind) => kind === 'link' ? 1 : 2;

/**
 * The materials of an Extra Deck summon, bottom first.
 * - Covered: the twin refs under the new card (same zone). A card in zone `material` belongs to its Xyz: it is not
 *   counted alone; its Xyz is the material (Rank-Up: an Xyz with materials is enough alone for an Xyz Summon).
 * - Vanished: monsters the camera sent to the hand in the window that are still there (not back on the field, not in
 *   a pile), newest first, only as many as needed (Link: up to its rating; others: up to the minimum).
 * Undefined = no summon (the default rules apply).
 */
export function fieldSummonMaterials({ kind, rating, covered, vanished, firstSeen, twins, removed }: {
  kind: RemoteSummonKind; rating?: number; covered: readonly string[]; vanished: readonly FieldVanish[]; firstSeen: number; twins: readonly TwinCard[];
  /** True while the camera still has this card out of view. */ removed: (ref: string) => boolean;
}): string[] | undefined {
  const find = (ref: string) => twins.find(c => c.ref === ref);
  const holder = (ref: string) => { const card = find(ref); return card?.zone === 'material' && card.materialOf ? card.materialOf : ref; };
  const onField = (card: TwinCard | undefined) => !!card && card.faceUp && MONSTER_ZONES.has(card.zone);
  const under = [...new Set(covered.map(holder))].filter(ref => onField(find(ref)));
  // A rank-up needs the Xyz under it, not 2 cards; the carried materials move with it on the server.
  const rankUp = kind === 'xyz' && under.some(ref => !!find(ref)?.materials?.length);
  const limit = kind === 'link' ? rating ?? 0 : Infinity;
  const left = [...vanished].filter(v => Math.abs(v.at - firstSeen) <= SUMMON_WINDOW_MS).sort((a, b) => b.at - a.at)
    .map(v => v.ref).filter(ref => !under.includes(ref) && removed(ref) && (() => {
      const card = find(ref);
      return !!card && card.zone === 'hand' && !!card.departedFrom && MONSTER_ZONES.has(card.departedFrom.zone);
    })());
  const want = Math.max(0, (kind === 'link' ? limit : rankUp ? 0 : fieldSummonMinimum(kind)) - under.length);
  const refs = [...under, ...left.slice(0, kind === 'link' ? Math.max(0, limit - under.length) : want).reverse()].slice(0, kind === 'link' ? limit : undefined);
  return refs.length && (rankUp || refs.length >= fieldSummonMinimum(kind)) ? refs : undefined;
}

/** Log line for a summon the camera recorded. */
export function fieldSummonNotice(kind: RemoteSummonKind, name: string, materials: readonly string[]): string {
  const label = kind === 'xyz' ? 'Xyz Summon' : `${kind[0].toUpperCase()}${kind.slice(1)} Summon`;
  return kind === 'xyz' ? `${label}: ${name} (${materials.length} material${materials.length === 1 ? '' : 's'})` : `${label}: ${materials.join(' + ')} → ${name} (materials to GY)`;
}
