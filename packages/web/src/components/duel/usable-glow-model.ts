import { LOCATION_EXTRA, LOCATION_GRAVE, LOCATION_REMOVED } from "./constants";
import type { SummonCircleTone } from "./summon-circle-model";

/** Glow tones are the summoning-circle tones: Extra Deck purple, GY teal, Banished gold. */
export type UsableGlowTone = SummonCircleTone;

/**
 * The glow tone for the cards of one pile, read from the location of its first card.
 * An empty pile or any other location falls back to the purple Extra Deck tone (the duel UI's own accent).
 */
export function usableGlowToneForPile(cards: readonly { location: number }[]): UsableGlowTone {
  const location = cards[0]?.location;
  if (location === LOCATION_GRAVE) return "gy";
  if (location === LOCATION_REMOVED) return "banish";
  if (location === LOCATION_EXTRA) return "extra";
  return "extra";
}
