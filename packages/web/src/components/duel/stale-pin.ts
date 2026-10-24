import type { DuelCard } from "@yugidraft/shared/duels";
import { LOCATION_FZONE, LOCATION_MZONE, LOCATION_PZONE, LOCATION_SZONE } from "./constants";

/**
 * A pinned card that left the board keeps its last copy (the pin ends only when the player closes it), but that copy is old: its ATK / DEF,
 * counters, materials and equip links no longer hold. `staleCopy` makes the copy the drawer shows for it: the printed card stays (name, art,
 * text, type line), the live parts are gone. The set remembers which copies are stale, so the board sync leaves them alone.
 */
/**
 * Why the copy is old: `gone` (the card left its zone) or `set` (a rival's card still lies in its zone, but face-down: the board shows no card there).
 * A copy of either kind returns to the live card when the board shows that card in that zone again (a monster that is flipped face-up).
 */
export type StaleReason = "gone" | "set";
const stale = new WeakMap<object, StaleReason>();

export function staleCopy(card: DuelCard, why: StaleReason = "gone"): DuelCard {
  if (stale.get(card) === why) return card;
  const copy: DuelCard = { ...card, attack: undefined, defense: undefined, hints: undefined, counters: undefined, materials: undefined, equippedTo: undefined, negated: undefined };
  stale.set(copy, why);
  return copy;
}

export function isStaleCopy(card: object): boolean {
  return stale.has(card);
}

export const STALE_LINE = "No longer on the field";
export const SET_LINE = "Set face-down";

/** The line a stale pin shows: where it was matters (a hand card that was summoned is on the field, but not under this pin). */
export function staleLine(card: DuelCard): string {
  if (stale.get(card) === "set") return SET_LINE;
  const field = card.location === LOCATION_MZONE || card.location === LOCATION_SZONE || card.location === LOCATION_FZONE || card.location === LOCATION_PZONE;
  return field ? STALE_LINE : "No longer in this zone";
}
