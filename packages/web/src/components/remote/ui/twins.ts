import type { RemoteActionProposal, RemoteRoom } from "@yugidraft/shared/remote";
import { cardCode, type TwinCard } from "./model";

/** Zones where a second copy of one public card is suspicious. A Graveyard copy counts only next to one on the field. */
const FIELD_ZONES = new Set(["monster", "spell-trap", "field", "extra-monster", "pendulum"]);

/** Two or more public cards of one seat with the same identity, at least one of them on the field. */
export type TwinGroup = {
  /** Same for the same set of cards, so a "Two copies" answer stays valid until another copy appears. */
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

/**
 * The one place that knows how a merge reaches the server.
 * The table service merges two tracked instances of one card (`twin.merge` with instance ids). When the cards are not both
 * tracked as instances, the extra card is removed instead: same board result, one Undo, one log line.
 * When the server gets a merge by card ref, only this function changes.
 */
export function mergeProposal(args: { room: RemoteRoom; seat: number; actorSeat: number; keep: TwinCard; remove: TwinCard; label: string }): RemoteActionProposal {
  const { room, seat, actorSeat, keep, remove, label } = args;
  const instances = room.state.deckChecks?.instances ?? [];
  const find = (ref: string) => instances.find(item => item.seat === seat && item.refs.includes(ref));
  const kept = find(keep.ref); const gone = find(remove.ref);
  if (kept && gone && kept.id !== gone.id && kept.copyKey === gone.copyKey)
    return { type: "twin.merge", actorSeat, seat, keepInstanceId: kept.id, removeInstanceId: gone.id, reason: `${MERGED} ${label}` };
  return { type: "twin.remove", actorSeat, seat, cardRef: remove.ref };
}
/** Log lines of a merge start with this, so the log can name the card. */
export const MERGED = "Merged duplicate";

/**
 * The server's answer to a manual placement of a card that is already on the field ("another copy?").
 * Returns the ref of the card already there, or null when the placement went through.
 */
export function copyFlagOf(room: RemoteRoom | null): string | null {
  const flag = (room?.state.identified as { alreadyOnField?: unknown } | null | undefined)?.alreadyOnField;
  if (typeof flag === "string") return flag;
  return flag && typeof (flag as { ref?: unknown }).ref === "string" ? (flag as { ref: string }).ref : null;
}
