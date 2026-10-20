import type { DuelCard, DuelEngineView } from "@yugidraft/shared/duels";
import { isFacedown, zoneKey } from "./constants";

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

/** The title of the Materials view (the pile viewer) of an Xyz with `count` attached cards. */
export function materialsTitle(count: number): string {
  return `Materials (${count})`;
}

/** The title the viewer shows: a Materials view counts the live cards, any other pile keeps its title. */
export function livePileTitle(view: PileView, cards: DuelCard[]): string {
  return view.host ? materialsTitle(cards.length) : view.title;
}

/** The Xyz zone a Materials view belongs to. The view reads that monster's attached cards live. */
export type PileHost = { controller: number; location: number; sequence: number };

/** A pile (Graveyard, Banished, Extra Deck...) opened in the centred viewer. `cards` is the snapshot at open time. `host`: a Materials view. */
export type PileView = { title: string; owner: "you" | "opp"; cards: DuelCard[]; open: boolean; seat?: number; host?: PileHost };

/** The face-up Xyz that stands in `host` now, or null when the zone is empty or the monster is face-down. */
function hostMonster(engine: Pick<DuelEngineView, "seats">, host: PileHost): DuelCard | null {
  for (const seat of engine.seats) {
    for (const card of seat.monsters) {
      if (card && card.controller === host.controller && card.location === host.location && card.sequence === host.sequence) return card;
    }
  }
  return null;
}

/**
 * The pile's live contents from the engine view, so the viewer follows moves while it is open. `seat` on the view names
 * the owner; without it "you" is the local seat and anything else is the first other seat. A spectator has no local seat:
 * seat 0 stands in.
 */
export function livePileCards(view: PileView, engine: Pick<DuelEngineView, "seats"> | null | undefined, localSeat: number | null): DuelCard[] {
  if (view.host) {
    // A Materials view: the Xyz's current attached cards. Empty once the Xyz left the zone or turned face-down.
    if (!engine) return view.cards;
    const monster = hostMonster(engine, view.host);
    return monster && monster.code != null && !isFacedown(monster.position) ? monster.materials ?? [] : [];
  }
  const local = localSeat ?? 0;
  const seat = engine?.seats.find((entry) => (view.seat != null ? entry.seat === view.seat : view.owner === "you" ? entry.seat === local : entry.seat !== local));
  if (!seat) return view.cards;
  const title = view.title.toLowerCase();
  if (/graveyard|\bgy\b/.test(title)) return seat.graveyard;
  if (/banish/.test(title)) return seat.banished;
  if (/extra/.test(title)) return seat.extra;
  return view.cards;
}
