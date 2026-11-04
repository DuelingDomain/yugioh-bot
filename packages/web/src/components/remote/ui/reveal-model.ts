import { searchCandidates, type RemoteActionProposal, type RemoteKnownHandCard, type RemoteState } from "@yugidraft/shared/remote";
import { cardInfo } from "./catalog";

/** Added-to-hand UI model. Contract: docs/remote-duels/added-to-hand.md (seat.knownHand, handCount, hand.add / hand.count). */
export type HandSource = RemoteKnownHandCard["source"];
/** The effect card behind an addition. */
export type HandBy = NonNullable<RemoteKnownHandCard["by"]>;
/** A card of a hand that all players know about: added by an effect, or returned from the field. */
export type KnownHandCard = { id: string; cardId: number; name: string; source: HandSource; by?: string; at: number };
export type HandCandidate = { cardId: number; name: string };

/** Short text for where the card came from: "from Deck · by Man with the Mark". */
export function sourceText(card: Pick<KnownHandCard, "source" | "by">): string {
  const from = card.source === "field" ? "returned from field" : card.source === "unknown" ? "added to hand" : `from ${{ deck: "Deck", gy: "Graveyard", banish: "Banished", extra: "Extra Deck" }[card.source]}`;
  return card.by ? `${from} \u00b7 by ${card.by}` : from;
}

/** Cards the table knows are in a hand. The catalog gives the names (the server sends card ids). */
export function knownHandOf(state: RemoteState, seat: number): KnownHandCard[] {
  return (state.seats[seat]?.knownHand ?? []).map(entry => ({
    id: entry.id, cardId: entry.cardId, name: cardInfo(entry.cardId)?.name ?? `Card ${entry.cardId}`, source: entry.source, by: entry.by?.name, at: entry.at,
  }));
}

/** The public hand size. Absent until a card moved or the owner set it. */
export const handCountOf = (state: RemoteState, seat: number): number | undefined => state.seats[seat]?.handCount;

/** An open search for this seat: a search card was used and no card is chosen yet. Candidates are deck-filtered. */
export const SEARCH_WINDOW_MS = 120_000;
export function openSearch(state: RemoteState, seat: number, dismissed: ReadonlySet<string>, fresh: (id: string) => boolean) {
  const origin = (state.effectTracking?.origins ?? []).filter(o => o.seat === seat && o.destination === "hand" && !o.chosenCardId && !o.announcedCard && !o.handCounted && !dismissed.has(o.id) && fresh(o.id)).at(-1);
  if (!origin) return undefined;
  const found = searchCandidates(state, seat, origin.source.cardId);
  const candidates: HandCandidate[] = found.length ? found.map(c => ({ cardId: c.cardId, name: c.name })) : (origin.candidates ?? []).map(c => ({ cardId: c.cardId, name: c.name }));
  return { id: origin.id, by: { cardId: origin.source.cardId, name: origin.source.name }, candidates };
}

/** The actor owns the hand; no seat field in the action. */
export const handAdd = (actor: number, card: HandCandidate, source: HandSource, by?: HandBy): RemoteActionProposal =>
  ({ type: "hand.add", actorSeat: actor, cardId: card.cardId, source, ...(by ? { by } : {}) });
/** The owner changes the hand size by a step (two quick taps add up). */
export const handCount = (actor: number, delta: number): RemoteActionProposal => ({ type: "hand.count", actorSeat: actor, delta });
