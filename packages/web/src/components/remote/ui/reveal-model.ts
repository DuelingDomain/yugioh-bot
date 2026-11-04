import type { RemoteActionProposal, RemoteState } from "@yugidraft/shared/remote";

/**
 * Stub of the added-to-hand backend (branch feat/remote-reveal, contract docs/remote-duels/added-to-hand.md).
 * Names follow the contract: seat.knownHand, actions hand.add / hand.reveal / hand.forget / hand.count,
 * searchCandidates(). Replace the casts with the shared types when the backend lands.
 */
export type HandSource = "deck" | "graveyard" | "banished" | "extra" | "field" | "unknown";
/** A card of a hand that all players know about: added by an effect, or returned from the field. */
export type KnownHandCard = { id: string; cardId: number; name: string; source: HandSource; by?: string; at: number };
export type HandCandidate = { cardId: number; name: string };

type SeatWithHand = { knownHand?: KnownHandCard[]; handCount?: number; resources?: Record<string, number> };

/** Short text for where the card came from: "from Deck · by Man with the Mark". */
export function sourceText(card: Pick<KnownHandCard, "source" | "by">): string {
  const from = card.source === "field" ? "returned from field" : card.source === "unknown" ? "added to hand" : `from ${{ deck: "Deck", graveyard: "Graveyard", banished: "Banished", extra: "Extra Deck" }[card.source]}`;
  return card.by ? `${from} · by ${card.by}` : from;
}

/**
 * Cards the table knows are in a hand. Uses seat.knownHand when the server sends it.
 * Until then, searched cards that were announced to all players stand in for it.
 */
export function knownHandOf(state: RemoteState, seat: number): KnownHandCard[] {
  const own = state.seats[seat] as unknown as SeatWithHand | undefined;
  if (own?.knownHand) return own.knownHand;
  return (state.effectTracking?.origins ?? []).filter(o => o.seat === seat && o.destination === "hand" && o.announcedCard)
    .map((o, i) => ({ id: `origin:${o.id}`, cardId: o.announcedCard!.cardId, name: o.announcedCard!.name, source: "deck" as const, by: o.source.name, at: i }));
}

/** The hand size. The owner sets it with hand.count. Empty until someone sets it. */
export function handCountOf(state: RemoteState, seat: number): number | undefined {
  const own = state.seats[seat] as unknown as SeatWithHand | undefined;
  return own?.handCount ?? own?.resources?.hand;
}

/** An open search for this seat: a search card was used and no card is chosen yet. Candidates are deck-filtered. */
export function openSearch(state: RemoteState, seat: number, dismissed: ReadonlySet<string>) {
  const origin = (state.effectTracking?.origins ?? []).filter(o => o.seat === seat && o.destination === "hand" && !o.chosenCardId && !o.announcedCard && !dismissed.has(o.id)).at(-1);
  if (!origin) return undefined;
  return { id: origin.id, by: origin.source.name, candidates: searchCandidates(state, seat, origin.source.cardId, origin.id) };
}

/** Stub of searchCandidates(state, seat, cardId): the deck-filtered cards this search card can add. */
export function searchCandidates(state: RemoteState, seat: number, _sourceCardId?: number, originId?: string): HandCandidate[] {
  const origin = (state.effectTracking?.origins ?? []).find(o => o.seat === seat && (originId ? o.id === originId : o.destination === "hand" && !o.chosenCardId));
  return (origin?.candidates ?? []).map(c => ({ cardId: c.cardId, name: c.name }));
}

export const handAdd = (seat: number, card: HandCandidate, source: HandSource, by?: string): RemoteActionProposal =>
  ({ type: "hand.add", actorSeat: seat, seat, cardId: card.cardId, name: card.name, source, ...(by ? { by } : {}) }) as unknown as RemoteActionProposal;
export const handCount = (actor: number, seat: number, count: number): RemoteActionProposal =>
  ({ type: "hand.count", actorSeat: actor, seat, count }) as unknown as RemoteActionProposal;
