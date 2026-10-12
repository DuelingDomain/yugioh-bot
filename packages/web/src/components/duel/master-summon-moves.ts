import type { DuelEvent, DuelSeatView, DuelZoneRef } from "@yugidraft/shared/duels";
import { LOCATION_DMZONE, LOCATION_MZONE } from "./constants";

const sameZone = (a: DuelZoneRef | undefined, b: DuelZoneRef | undefined): boolean =>
  a != null && b != null && a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;

/** Id of the made-up move: just before the summon it belongs to, so the pair keeps its order and no real id is taken. */
const moveIdOf = (event: DuelEvent): number => event.id - 0.5;

/**
 * The seat views one step before each seat views array. The table gets a new array per update (the poll or the socket), so the
 * first call that sees an array reads the one seen before as its previous. Every layer asks with the same array in one
 * render, and only the first ask moves the pair on.
 */
const previousOf = new WeakMap<readonly DuelSeatView[], readonly DuelSeatView[] | null>();
let lastSeats: readonly DuelSeatView[] | null = null;

function previousSeats(seats: readonly DuelSeatView[]): readonly DuelSeatView[] | null {
  if (!previousOf.has(seats)) {
    previousOf.set(seats, lastSeats === seats ? null : lastSeats);
    lastSeats = seats;
  }
  return previousOf.get(seats) ?? null;
}

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
 *
 * The seat view must show the card leaving: in the view before, `deckMaster.inZone` was true, and in this one it is false.
 * Another copy of the master (Special Summoned from Xyz material, whose moves the server drops too) arrives the same way,
 * but the real master stays in its zone, so it gets no flight from the plate.
 */
export function withMasterSummonMoves(events: readonly DuelEvent[], seats: readonly DuelSeatView[] | undefined): DuelEvent[] {
  if (!seats) return events as DuelEvent[];
  const before = previousSeats(seats);
  const masters = new Map<number, number>();
  for (const seat of seats) {
    const master = seat.deckMaster;
    const was = before?.find((item) => item.seat === seat.seat)?.deckMaster;
    // Leaving its zone: in the zone in the view before, out of it in this one.
    if (master && !master.inZone && was?.inZone && was.card.code === master.card.code) masters.set(seat.seat, master.card.code);
  }
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
    // Any earlier move into that zone of the batch is the card's own: look back to the start. Another card of a known name is not.
    for (let back = 0; back < index; back += 1) {
      const other = events[back];
      if (other.kind !== "move" || !sameZone(other.zone, zone)) continue;
      if (!named || other.card == null || other.card.code <= 0 || other.card.code === event.card!.code) return;
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
