import type { RemoteActionProposal } from "@yugidraft/shared/remote";
import { cardCode, type TwinCard } from "./model";

/** Zones where a second copy of one public card is suspicious. A Graveyard copy counts only next to one on the field. */
const FIELD_ZONES = new Set(["monster", "spell-trap", "field", "extra-monster", "pendulum"]);

/** Two or more public cards of one seat with the same identity, at least one of them on the field. */
export type TwinGroup = {
  /** Stable for the same set of physical refs. */
  key: string;
  cardId: number;
  cards: TwinCard[];
};

export function findTwinGroups(twin: readonly TwinCard[]): TwinGroup[] {
  const byCode = new Map<number, TwinCard[]>();
  for (const card of twin) {
    const code = cardCode(card);
    if (!card.faceUp || !code || (!FIELD_ZONES.has(card.zone) && card.zone !== "graveyard")) continue;
    byCode.set(code, [...(byCode.get(code) ?? []), card]);
  }
  const groups: TwinGroup[] = [];
  for (const [cardId, cards] of byCode) {
    if (cards.length < 2 || !cards.some(card => FIELD_ZONES.has(card.zone))) continue;
    groups.push({ key: cards.map(card => card.ref).sort().join("|"), cardId, cards });
  }
  return groups;
}

/** The card to keep: the one the camera tracks, else one on the field (not the Graveyard), else the newest. */
export function chooseKeep(group: TwinGroup, trackedRefs: ReadonlySet<string>): { keep: TwinCard; remove: TwinCard } {
  const rank = (card: TwinCard) => (trackedRefs.has(card.ref) ? 2 : 0) + (FIELD_ZONES.has(card.zone) ? 1 : 0);
  // The twin list keeps placement order, so a later index is the newer card.
  const ordered = group.cards.map((card, index) => ({ card, index })).sort((a, b) => rank(b.card) - rank(a.card) || b.index - a.index);
  const keep = ordered[0].card;
  // Remove the lowest-ranked other copy (the oldest, or the Graveyard one).
  const remove = ordered.slice(1).reverse()[0].card;
  return { keep, remove };
}

/** Merge by card ref (server `twin.merge`): the owner keeps one twin and the duplicate goes. One action, one Undo, one log line. */
export function mergeProposal(args: { seat: number; actorSeat: number; keep: TwinCard; remove: TwinCard; label: string }): RemoteActionProposal {
  const { seat, actorSeat, keep, remove, label } = args;
  return { type: "twin.merge", actorSeat, seat, keepRef: keep.ref, removeRef: remove.ref, reason: `${MERGED} ${label}` };
}
/** Log lines of a merge start with this, so the log can name the card. */
export const MERGED = "Merged duplicate";
