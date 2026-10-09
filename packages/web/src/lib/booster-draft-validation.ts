import type { DraftConfig } from "@yugidraft/shared/types";
import { boosterMainRounds, mainPicksPerPlayerError } from "@yugidraft/shared/services";

/** Keep normal create/edit numeric limits and round derivation identical. Extra-only edits keep main values. */
export function normalizeBoosterDraftNumbers(config: DraftConfig, submitted: DraftConfig = config): string | null {
  if (submitted.mainPicksPerPlayer === undefined && submitted.cardsPerPlayer === undefined && submitted.packSize === undefined && submitted.packsPerPlayer === undefined) return null;
  if (config.mainPicksPerPlayer !== undefined) {
    const targetError = mainPicksPerPlayerError(config);
    if (targetError) return targetError;
    const packSize = config.packSize ?? 8;
    if (!Number.isInteger(packSize) || packSize < 5 || packSize > 120) return "Pack size must be 5 to 120";
    config.packSize = packSize;
    config.packsPerPlayer = boosterMainRounds(config);
    return null;
  }
  const cardsPerPlayer = config.cardsPerPlayer === undefined ? 40 : config.cardsPerPlayer;
  const packSize = config.packSize === undefined ? 8 : config.packSize;
  if (!Number.isInteger(cardsPerPlayer) || cardsPerPlayer < 40 || cardsPerPlayer > 120) return "Cards per player must be 40 to 120";
  if (!Number.isInteger(packSize) || packSize < 5 || packSize > cardsPerPlayer) return "Pack size must be 5 to cards per player";
  const packs = submitted.packsPerPlayer === undefined ? Math.ceil(cardsPerPlayer / packSize) : submitted.packsPerPlayer;
  if (!Number.isSafeInteger(packs) || packs < 1) return "Packs per player must be a positive whole number";
  config.cardsPerPlayer = cardsPerPlayer;
  config.packSize = packSize;
  config.packsPerPlayer = packs;
  return null;
}
