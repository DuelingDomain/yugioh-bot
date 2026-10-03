import type { DuelCard, DuelEngineView } from "@yugidraft/shared/duels";
import { zoneKey } from "./constants";

/**
 * Whether an open pile viewer must close when a new prompt arrives. The viewer is a modal sheet over the
 * board, so a prompt that wants cards on the field (summon materials, targets) cannot be answered while it
 * stays open. A legal card in the pile always keeps it open (picking GY cards one at a time).
 * `answered`: the player answered the last prompt while the viewer was open (e.g. an Extra Deck summon). The
 * viewer then closes unless the new prompt is theirs and wants a card in the pile. Otherwise a prompt that
 * is not theirs or has no card choices leaves a pile they are only browsing alone.
 */
export function shouldClosePileForPrompt(
  pileCards: DuelCard[],
  legalKeys: Set<string>,
  promptMine: boolean,
  answered = false,
): boolean {
  const wantsPile = promptMine && pileCards.some((card) => legalKeys.has(zoneKey(card.controller, card.location, card.sequence)));
  if (wantsPile) return false;
  if (answered) return true;
  return promptMine && legalKeys.size > 0;
}

/** A pile (Graveyard, Banished, Extra Deck...) opened in the centred viewer. `cards` is the snapshot at open time. */
export type PileView = { title: string; owner: "you" | "opp"; cards: DuelCard[]; open: boolean; seat?: number };

/**
 * The pile's live contents from the engine view, so the viewer follows moves while it is open. `seat` on the view names
 * the owner; without it "you" is the local seat and anything else is the first other seat. A spectator has no local seat:
 * seat 0 stands in.
 */
export function livePileCards(view: PileView, engine: Pick<DuelEngineView, "seats"> | null | undefined, localSeat: number | null): DuelCard[] {
  const local = localSeat ?? 0;
  const seat = engine?.seats.find((entry) => (view.seat != null ? entry.seat === view.seat : view.owner === "you" ? entry.seat === local : entry.seat !== local));
  if (!seat) return view.cards;
  const title = view.title.toLowerCase();
  if (/graveyard|\bgy\b/.test(title)) return seat.graveyard;
  if (/banish/.test(title)) return seat.banished;
  if (/extra/.test(title)) return seat.extra;
  return view.cards;
}
