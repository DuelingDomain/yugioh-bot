/** Which piles show a summoning circle: the local player's Extra Deck, GY and Banished when a card in the pile has a legal action. */

export type SummonCircleTone = "extra" | "gy" | "banish";

const TONES: Record<string, SummonCircleTone> = { extra: "extra", gy: "gy", banish: "banish" };

/**
 * The circle tone for one pile, or null when the pile shows no circle.
 * `keys` are the zone keys of the cards in the pile (one key per card);
 * an empty pile has no card to act on, so it never shows a circle.
 */
export function pileSummonTone({
  kind,
  side,
  count,
  keys,
  legalKeys,
}: {
  kind: string;
  side: "opp" | "you";
  count: number;
  keys: readonly string[];
  legalKeys: ReadonlySet<string>;
}): SummonCircleTone | null {
  if (side !== "you" || count <= 0) return null;
  const tone = TONES[kind];
  if (!tone) return null;
  for (const key of keys) {
    if (legalKeys.has(key)) return tone;
  }
  return null;
}
