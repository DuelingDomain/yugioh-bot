import type { DraftConfig } from "../types/index.js";
import { buildDealWithRemainder, seededShuffle, type ShuffleSeed } from "./deal.js";

import { boosterMainRounds } from "../types/draft-size.js";
export { boosterMainRounds, mainDraftPicksPerPlayer, cardsPerPlayerError, effectiveDraftNumbers, derivedBoosterMainRounds } from "../types/draft-size.js";

/** Keep the same shuffle and full-pack deal, allowing an authored pool to end in partial packs. */
export function buildCappedBoosterDeal(cardIds: number[], players: number, config: DraftConfig, seed: ShuffleSeed) {
  const waves = boosterMainRounds(config);
  const packSize = config.packSize ?? 8;
  if (cardIds.length >= players * waves * packSize) {
    return buildDealWithRemainder(cardIds, { players, waves, packSize, seed });
  }
  const deck = seededShuffle(cardIds, seed);
  const packs: number[][] = [];
  let position = 0;
  for (let wave = 0; wave < waves; wave++) {
    const remaining = Math.min(deck.length - position, players * packSize);
    for (let seat = 0; seat < players; seat++) {
      const size = Math.floor(remaining / players) + (seat < remaining % players ? 1 : 0);
      packs.push(deck.slice(position, position + size));
      position += size;
    }
  }
  return { packs, remainder: deck.slice(position) };
}
