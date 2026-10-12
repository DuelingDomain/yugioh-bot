import type { DuelEvent, DuelSeatView, DuelZoneRef } from "@yugidraft/shared/duels";
import { LOCATION_DMZONE, LOCATION_MZONE } from "./constants";

const sameZone = (a: DuelZoneRef | undefined, b: DuelZoneRef | undefined): boolean =>
  a != null && b != null && a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;

/** A move sits at most this many events before the summon or set it lands for (the planner pairs them over the same span). */
const PAIR_SPAN = 8;

/** Id of the made-up move: just before the summon it belongs to, so the pair keeps its order and no real id is taken. */
const moveIdOf = (event: DuelEvent): number => event.id - 0.5;

const filled = new WeakMap<readonly DuelEvent[], { seats: string; events: readonly DuelEvent[] }>();

/**
 * The Deck Master leaves its zone without a `move` event. The core names that zone 0x4000, which a byte-sized MOVE
 * message reads as location 0, and the move feed drops every move with a location of 0. What arrives is the summon
 * (or the Set) alone: a monster-zone event for the seat's Deck Master with no move into that zone before it. Every
 * other card reaches a monster zone with a move (hand, Deck, Extra Deck, pile, field), so that gap is the zone.
 *
 * This adds the move the card flies on: from the Deck Master Zone of that seat to the zone of the summon, placed just
 * before it. The flight then starts at the Deck Master plate or zone cell like any other move. A Flip Summon never
 * moves, and a card that already has a move into its zone keeps it. The same array comes back when nothing needed
 * one, and the same input gives the same output.
 */
export function withMasterSummonMoves(events: readonly DuelEvent[], seats: readonly DuelSeatView[] | undefined): DuelEvent[] {
  if (!seats) return events as DuelEvent[];
  const masters = new Map<number, number>();
  for (const seat of seats) if (seat.deckMaster) masters.set(seat.seat, seat.deckMaster.card.code);
  if (masters.size === 0) return events as DuelEvent[];
  const seatsKey = [...masters].map(([seat, code]) => `${seat}:${code}`).join(",");
  const cached = filled.get(events);
  if (cached && cached.seats === seatsKey) return cached.events as DuelEvent[];

  const made = new Map<number, DuelEvent>();
  events.forEach((event, index) => {
    if ((event.kind !== "summon" && event.kind !== "set") || event.summonKind === "flip") return;
    const zone = event.zone;
    if (!zone || zone.location !== LOCATION_MZONE) return;
    const code = masters.get(zone.controller);
    if (code == null) return;
    // A Set may hide its card from a viewer; a summon names it, and it must be the master.
    const named = event.card != null && event.card.code > 0;
    if (event.kind === "summon" && !(named && event.card!.code === code)) return;
    if (named && event.card!.code !== code) return;
    for (let back = Math.max(0, index - PAIR_SPAN); back < index; back += 1) {
      const other = events[back];
      if (other.kind === "move" && sameZone(other.zone, zone)) return;
    }
    made.set(event.id, {
      id: moveIdOf(event),
      kind: "move",
      seat: event.seat ?? zone.controller,
      card: event.card,
      text: event.text,
      zone: { ...zone },
      from: { controller: zone.controller, location: LOCATION_DMZONE, sequence: 0 },
      reason: event.kind === "set" ? "set" : "summon",
      faceDown: event.kind === "set",
    });
  });
  if (made.size === 0) {
    filled.set(events, { seats: seatsKey, events });
    return events as DuelEvent[];
  }
  const out: DuelEvent[] = [];
  for (const event of events) {
    const move = made.get(event.id);
    if (move) out.push(move);
    out.push(event);
  }
  filled.set(events, { seats: seatsKey, events: out });
  return out;
}
