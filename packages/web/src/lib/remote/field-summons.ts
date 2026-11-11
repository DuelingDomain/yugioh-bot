import type { RemoteSummonKind, TwinCard } from '@yugidraft/shared/remote';
import type { FieldZoneFacts } from './field-legality';

/** A monster that left its zone (camera "removed"), in watcher time (track.lastSeen). */
export type FieldVanish = { ref: string; at: number };
/** Summon window: materials that went under the card or left the field up to 5 s before its first outline (or after its placement). */
export const SUMMON_WINDOW_MS = 5000;
const MONSTER_ZONES = new Set(['monster', 'extra-monster']);
/** Same as the server: a monster the camera moved off the field this long ago can still be a material. */
export const SUMMON_DEPARTURE_MS = 30_000;
/** A card the camera took off a Monster Zone this long ago (server time) is a material candidate whatever the watcher clocks say: an Extra Deck search is often slower than the 5 s window. */
export const SUMMON_RECENT_MS = 15_000;

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
export function fieldSummonMaterials({ kind, rating, covered, vanished, pending = [], firstSeen, twins, removed, now }: {
  kind: RemoteSummonKind; rating?: number; covered: readonly string[]; vanished: readonly FieldVanish[]; firstSeen: number; twins: readonly TwinCard[];
  /** Monsters that left the view during the 2 s departure wait: still on the field in the twin, not yet in the hand. */ pending?: readonly FieldVanish[];
  /** True while the camera still has this card out of view. */ removed: (ref: string) => boolean;
  /** Server time: a covered card that the default sent to the hand (held stack) still counts for 30 s. */ now: number;
}): string[] | undefined {
  const find = (ref: string) => twins.find(c => c.ref === ref);
  const holder = (ref: string) => { const card = find(ref); return card?.zone === 'material' && card.materialOf ? card.materialOf : ref; };
  const justLeft = (card: TwinCard) => card.zone === 'hand' && !!card.departedFrom && MONSTER_ZONES.has(card.departedFrom.zone) &&
    card.departedFrom.at !== undefined && now - card.departedFrom.at <= SUMMON_DEPARTURE_MS;
  const onField = (card: TwinCard | undefined) => !!card && (card.faceUp && MONSTER_ZONES.has(card.zone) || justLeft(card));
  const under = [...new Set(covered.map(holder))].filter(ref => onField(find(ref)));
  // A rank-up needs the Xyz under it, not 2 cards; the carried materials move with it on the server.
  const rankUp = kind === 'xyz' && under.some(ref => !!find(ref)?.materials?.length);
  const limit = kind === 'link' ? rating ?? 0 : Infinity;
  const gone = (ref: string) => { const card = find(ref); return !!card && card.zone === 'hand' && !!card.departedFrom && MONSTER_ZONES.has(card.departedFrom.zone); };
  // A pending departure is not in the hand yet: it counts while its twin still lies face-up in a Monster Zone and the camera has not seen it again.
  const waiting = (ref: string) => { const card = find(ref); return !!card && card.faceUp && MONSTER_ZONES.has(card.zone); };
  const left = [...vanished.map(v => ({ ...v, ok: gone })), ...pending.map(v => ({ ...v, ok: waiting }))]
    .filter(v => Math.abs(v.at - firstSeen) <= SUMMON_WINDOW_MS).sort((a, b) => b.at - a.at)
    .filter((v, index, all) => all.findIndex(o => o.ref === v.ref) === index)
    .map(v => v.ok(v.ref) ? v.ref : '').filter(ref => ref && !under.includes(ref) && removed(ref));
  // Cards the board already holds in the hand after a camera lift (the default for a card out of view), newest first, after the window ones.
  const recent = twins.filter(c => c.zone === 'hand' && !!c.departedFrom?.auto && MONSTER_ZONES.has(c.departedFrom.zone) && c.departedFrom.at !== undefined && now - c.departedFrom.at <= SUMMON_RECENT_MS &&
    !under.includes(c.ref) && !left.includes(c.ref)).sort((a, b) => b.departedFrom!.at! - a.departedFrom!.at!).map(c => c.ref);
  const want = Math.max(0, (kind === 'link' ? limit : rankUp ? 0 : fieldSummonMinimum(kind)) - under.length);
  const refs = [...under, ...[...left, ...recent].slice(0, kind === 'link' ? Math.max(0, limit - under.length) : want).reverse()].slice(0, kind === 'link' ? limit : undefined);
  return refs.length && (rankUp || refs.length >= fieldSummonMinimum(kind)) ? refs : undefined;
}

/** Log line for a summon the camera recorded. */
export function fieldSummonNotice(kind: RemoteSummonKind, name: string, materials: readonly string[]): string {
  const label = kind === 'xyz' ? 'Xyz Summon' : `${kind[0].toUpperCase()}${kind.slice(1)} Summon`;
  return kind === 'xyz' ? `${label}: ${name} (${materials.length} material${materials.length === 1 ? '' : 's'})` : `${label}: ${materials.join(' + ')} → ${name} (materials to GY)`;
}

/**
 * The 5 s stack hold ended: apply the default only if the camera still sees the same stack. The top card is still in
 * that zone and seen, nothing new lies on it (no Xyz arrived), the card under it is still under it and still in its slot.
 */
export function heldStackStillStacked({ mover, zone, under, below, location }: {
  mover: { visible?: boolean; removed?: boolean; zone: string; under?: string } | undefined; zone: string; under: readonly string[];
  below: TwinCard | undefined; location: { zone: string; slot?: number };
}): boolean {
  return !!mover && !!mover.visible && !mover.removed && !mover.under && mover.zone === zone && !!below && under.includes(below.ref) &&
    below.zone === location.zone && below.slot === location.slot;
}
