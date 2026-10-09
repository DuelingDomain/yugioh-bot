import type { DraftConfig } from "@yugidraft/shared/types";
import { cardsPerPlayerError, derivedBoosterMainRounds } from "@yugidraft/shared/services";

/** Host Main cap determines rounds; Extra-only edits retain the existing Main setup. */
export function normalizeBoosterDraftNumbers(config: DraftConfig, submitted: DraftConfig = config): string | null {
  if (submitted.cardsPerPlayer === undefined && submitted.packSize === undefined && submitted.packsPerPlayer === undefined) return null;
  const capError = cardsPerPlayerError(config);
  if (capError) return capError;
  const cardsPerPlayer = config.cardsPerPlayer ?? 40;
  const packSize = config.packSize === undefined ? 8 : config.packSize;
  if (!Number.isInteger(packSize) || packSize < 5 || packSize > 120) return "Pack size must be 5 to 120";
  // Accept historical clients' round fields, but derive the effective value from the sole cap.
  const packs = submitted.packsPerPlayer;
  if (packs !== undefined && (!Number.isSafeInteger(packs) || packs < 1)) return "Packs per player must be a positive whole number";
  config.cardsPerPlayer = cardsPerPlayer;
  config.packSize = packSize;
  config.packsPerPlayer = derivedBoosterMainRounds(config);
  return null;
}
