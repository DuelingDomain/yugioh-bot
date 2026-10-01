/**
 * Detects "the Deck Master went back to the Deck Master Zone".
 *
 * The server sends no move event for this: the engine's MOVE message names the Deck Master Zone
 * (0x4000) with a byte-sized location that reads as 0, and the move feed skips such moves. What the
 * client does get is the seat view, where `deckMaster.inZone` turns true again and `deckMaster.returns`
 * goes up by one (the core adds 1 each time the master enters the zone from somewhere else). So the
 * return is read from two consecutive views. The events of the same batch only say where it came from.
 *
 * Source of the return, best first:
 *   1. a move event for the master that ends in the Deck Master Zone (if a server ever sends one);
 *   2. the last move event for the master in this batch (it went field -> Graveyard, then came back);
 *   3. where the previous view had the master (Graveyard, banished, hand, a field zone);
 *   4. that player's Graveyard pile.
 */
import type { DuelCard, DuelEvent, DuelSeatView, DuelZoneRef } from "@yugidraft/shared/duels";
import { LOCATION_DMZONE, LOCATION_GRAVE } from "./constants";

export type MasterReturnSource = "event" | "board" | "fallback";

export type MasterReturn = {
  seat: number;
  /** Passcode of the master card. */
  code: number;
  /** The seat's return count after this return. */
  returns: number;
  /** Where the card was before it went back. */
  from: DuelZoneRef;
  /** How `from` was found: an event, the previous view, or the Graveyard fallback. */
  source: MasterReturnSource;
};

/** Where the previous view had the card with this code, or null when it was not in the visible zones. */
export function locateCard(view: DuelSeatView, code: number): DuelZoneRef | null {
  const zones: Array<ReadonlyArray<DuelCard | null>> = [
    view.monsters,
    view.spells,
    view.graveyard,
    view.banished,
    view.hand,
    view.extra,
  ];
  for (const zone of zones) {
    for (const card of zone) {
      if (card && card.code === code) {
        return { controller: card.controller, location: card.location, sequence: card.sequence };
      }
    }
  }
  return null;
}

/** The source named by the batch's move events, newest first, or null. */
function sourceFromEvents(fresh: readonly DuelEvent[], code: number): DuelZoneRef | null {
  let lastElsewhere: DuelZoneRef | null = null;
  for (let i = fresh.length - 1; i >= 0; i -= 1) {
    const event = fresh[i];
    if (event.kind !== "move" || event.card?.code !== code || !event.zone) continue;
    if (event.zone.location === LOCATION_DMZONE) {
      if (event.from && event.from.location !== LOCATION_DMZONE && event.from.location !== 0) return { ...event.from };
      continue;
    }
    if (lastElsewhere == null) lastElsewhere = { ...event.zone };
  }
  return lastElsewhere;
}

/**
 * The masters that returned between `prev` and `next`. `prev` is null for the first view (no
 * animation then). A master counts as returned when it was out of the zone and is in it now, or
 * when its return count went up (it left and came back inside one batch of messages).
 */
export function detectMasterReturns(
  prev: readonly DuelSeatView[] | null | undefined,
  next: readonly DuelSeatView[],
  fresh: readonly DuelEvent[] = [],
): MasterReturn[] {
  if (!prev) return [];
  const out: MasterReturn[] = [];
  for (const seat of next) {
    const master = seat.deckMaster;
    if (!master || !master.inZone) continue;
    const before = prev.find((item) => item.seat === seat.seat)?.deckMaster;
    if (!before || before.card.code !== master.card.code) continue;
    const left = !before.inZone || master.returns > before.returns;
    if (!left) continue;
    const code = master.card.code;
    const prevView = prev.find((item) => item.seat === seat.seat);
    const fromEvent = sourceFromEvents(fresh, code);
    const fromBoard = fromEvent || before.inZone || !prevView ? null : locateCard(prevView, code);
    out.push({
      seat: seat.seat,
      code,
      returns: master.returns,
      from: fromEvent ?? fromBoard ?? { controller: seat.seat, location: LOCATION_GRAVE, sequence: 0 },
      source: fromEvent ? "event" : fromBoard ? "board" : "fallback",
    });
  }
  return out;
}
