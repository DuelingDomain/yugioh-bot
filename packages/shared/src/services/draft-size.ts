import type { DraftConfig } from "../types/index.js";
import { buildDealWithRemainder, seededShuffle, type ShuffleSeed } from "./deal.js";

export function mainPicksPerPlayerError(config: DraftConfig): string | null {
  const target = config.mainPicksPerPlayer;
  return target !== undefined && (!Number.isInteger(target) || target < 20 || target > 60)
    ? "Main Deck cards per player must be a whole number from 20 to 60" : null;
}

export function mainDraftPicksPerPlayer(config: DraftConfig): number {
  return config.mainPicksPerPlayer ?? config.cardsPerPlayer ?? 40;
}

/** A requested deck size determines the main rounds; absent means legacy pack count. */
export function boosterMainRounds(config: DraftConfig): number {
  return config.mainPicksPerPlayer === undefined ? config.packsPerPlayer ?? 5
    : Math.ceil(config.mainPicksPerPlayer / (config.packSize ?? 8));
}

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
