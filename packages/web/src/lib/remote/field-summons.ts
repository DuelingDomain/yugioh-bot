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
  if (/\blink\b/i.test(type) || facts?.frameType === 'link') return { kind: 'link', rating: facts?.level ?? undefined };
  if (/\bfusion\b/i.test(type)) return { kind: 'fusion' };
}

/**
 * The materials of an Extra Deck summon, bottom first: the face-up monsters under the new card (covered), then the
 * monsters that vanished in the window (oldest first). Never more than these cards; Link takes at most its rating
 * (the newest ones). Xyz / Synchro / Fusion need 2+, Link 1+. Undefined = no summon (the default rules apply).
 */
export function fieldSummonMaterials({ kind, rating, covered, vanished, firstSeen, twins }: {
  kind: RemoteSummonKind; rating?: number; covered: readonly string[]; vanished: readonly FieldVanish[]; firstSeen: number; twins: readonly TwinCard[];
}): string[] | undefined {
  const usable = (ref: string) => {
    const card = twins.find(c => c.ref === ref);
    if (!card || !card.faceUp && card.zone !== 'hand') return false;
    return MONSTER_ZONES.has(card.zone) || card.zone === 'hand' && !!card.departedFrom && MONSTER_ZONES.has(card.departedFrom.zone);
  };
  const recent = vanished.filter(v => Math.abs(v.at - firstSeen) <= SUMMON_WINDOW_MS).sort((a, b) => a.at - b.at).map(v => v.ref);
  let refs = [...new Set([...covered, ...recent])].filter(usable);
  if (kind === 'link' && rating && refs.length > rating) refs = [...refs.filter(r => covered.includes(r)), ...refs.filter(r => !covered.includes(r))].slice(0, rating);
  return refs.length >= (kind === 'link' ? 1 : 2) ? refs : undefined;
}

/** Log line for a summon the camera recorded. */
export function fieldSummonNotice(kind: RemoteSummonKind, name: string, materials: readonly string[]): string {
  const label = kind === 'xyz' ? 'Xyz Summon' : `${kind[0].toUpperCase()}${kind.slice(1)} Summon`;
  return kind === 'xyz' ? `${label}: ${name} (${materials.length} materials)` : `${label}: ${materials.join(' + ')} → ${name} (materials to GY)`;
}
