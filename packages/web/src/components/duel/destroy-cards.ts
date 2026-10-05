import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";

const sameZone = (a: DuelZoneRef | undefined, b: DuelZoneRef | undefined): boolean =>
  a != null && b != null && a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;

const known = (event: DuelEvent): boolean => event.card != null && event.card.code > 0;

const filled = new WeakMap<readonly DuelEvent[], readonly DuelEvent[]>();

/** A destroy marker sits next to its move: a move of the same zone farther away belongs to another card. */
const MAX_ID_GAP = 6;

/**
 * The server hides the card of a destroy marker for a face-down card from its opponent ("A face-down card was
 * destroyed"), but the move that sends the card to its pile is public and names it. The effects need the card to
 * stand in the zone while the effect hits it, so a card-less destroy takes the card of the nearest move that
 * leaves the same zone (the one before it wins a tie). Other events and the text are not changed. The same array
 * comes back when nothing needed a card, and the same input gives the same output.
 */
export function withDestroyCards(events: readonly DuelEvent[]): DuelEvent[] {
  const cached = filled.get(events);
  if (cached) return cached as DuelEvent[];
  let changed = false;
  const out = events.map((event) => {
    if (event.kind !== "destroy" || known(event) || !event.zone) return event;
    let match: DuelEvent | undefined;
    let gap = MAX_ID_GAP + 1;
    for (const other of events) {
      if (other.kind !== "move" || !known(other) || !sameZone(other.from, event.zone)) continue;
      const distance = Math.abs(other.id - event.id);
      if (distance < gap || (distance === gap && match != null && other.id < match.id)) {
        match = other;
        gap = distance;
      }
    }
    if (!match?.card || gap > MAX_ID_GAP) return event;
    changed = true;
    return { ...event, card: match.card };
  });
  const result = changed ? out : events;
  filled.set(events, result);
  return result as DuelEvent[];
}
