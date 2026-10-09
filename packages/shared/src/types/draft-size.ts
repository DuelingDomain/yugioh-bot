import type { DraftConfig } from "./index.js";

/** Host input limits; existing drafts may retain smaller historical targets. */
export function cardsPerPlayerError(config: DraftConfig): string | null {
  const cap = config.cardsPerPlayer;
  return cap !== undefined && (!Number.isInteger(cap) || cap < 40 || cap > 120)
    ? "Cards per player must be a whole number from 40 to 120" : null;
}

export function mainDraftPicksPerPlayer(config: DraftConfig): number {
  return config.cardsPerPlayer ?? 40;
}

export function derivedBoosterMainRounds(config: DraftConfig): number {
  return Math.ceil(mainDraftPicksPerPlayer(config) / (config.packSize ?? 8));
}

/** Normalized new configs derive rounds; active historical drafts keep their saved deal boundaries. */
export function boosterMainRounds(config: DraftConfig): number {
  return config.packsPerPlayer ?? derivedBoosterMainRounds(config);
}

export function effectiveDraftNumbers(config: DraftConfig, preserveBoosterRounds = false) {
  return {
    cardsPerPlayer: mainDraftPicksPerPlayer(config),
    packsPerPlayer: preserveBoosterRounds ? config.packsPerPlayer ?? 5 : derivedBoosterMainRounds(config),
  };
}
