/**
 * Ring colours for players without an avatar. Violet is kept for "you" (Mono's `you`)
 * and gold for wins, so neither is in the palette.
 */
export const RING_PALETTE = ["#c86fd0", "#5fbf7f", "#6f8fe0", "#4fb39a", "#c9c25a", "#7fb6d9", "#d68fa8"] as const;

/** The same player always gets the same ring, on every page. */
export function ringColour(playerId: number | string): string {
  const key = String(playerId);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return RING_PALETTE[hash % RING_PALETTE.length];
}
