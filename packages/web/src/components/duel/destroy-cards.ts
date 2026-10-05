import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";

const sameZone = (a: DuelZoneRef | undefined, b: DuelZoneRef | undefined): boolean =>
  a != null && b != null && a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;

const known = (event: DuelEvent): boolean => event.card != null && event.card.code > 0;

const filled = new WeakMap<readonly DuelEvent[], readonly DuelEvent[]>();

/** A destroy marker sits next to its move: a move of the same zone farther away belongs to another card. */
const MAX_ID_GAP = 6;

/**
 * The server hides the card of a destroy marker for a face-down card from its opponent ("A face-down card was
 * destroyed"), but the move that sends the card to its pile is public, is marked reason "destroy" and names it.
 * The effects need the card to stand in the zone while the effect hits it, so a card-less destroy takes the card
 * of the nearest move that leaves the same zone for that reason. A move is used at most once, and never when a
 * destroy that already names a card claims it (that one knows its own card); when it is not certain, the destroy
 * stays card-less and the effects show a sleeve. Other events and the text are not changed. The same array comes
 * back when nothing needed a card, and the same input gives the same output.
 */
export function withDestroyCards(events: readonly DuelEvent[]): DuelEvent[] {
  const cached = filled.get(events);
  if (cached) return cached as DuelEvent[];
  const claimed = new Set<number>();
  // A destroy that names its card keeps its own move.
  for (const event of events) {
    if (event.kind !== "destroy" || !known(event) || !event.zone) continue;
    const own = nearestMove(events, event, claimed);
    if (own && own.card?.code === event.card?.code) claimed.add(own.id);
  }
  let changed = false;
  const out = events.map((event) => {
    if (event.kind !== "destroy" || known(event) || !event.zone) return event;
    const match = nearestMove(events, event, claimed);
    if (!match?.card) return event;
    claimed.add(match.id);
    changed = true;
    return { ...event, card: match.card };
  });
  const result = changed ? out : events;
  filled.set(events, result);
  return result as DuelEvent[];
}

/** The closest unclaimed destroy move out of the zone of this destroy (the one before it wins a tie). */
function nearestMove(events: readonly DuelEvent[], destroy: DuelEvent, claimed: ReadonlySet<number>): DuelEvent | undefined {
  let match: DuelEvent | undefined;
  let gap = MAX_ID_GAP + 1;
  for (const other of events) {
    if (other.kind !== "move" || other.reason !== "destroy" || !known(other) || claimed.has(other.id) || !sameZone(other.from, destroy.zone)) continue;
    const distance = Math.abs(other.id - destroy.id);
    if (distance < gap || (distance === gap && match != null && other.id < match.id)) {
      match = other;
      gap = distance;
    }
  }
  return gap <= MAX_ID_GAP ? match : undefined;
}
