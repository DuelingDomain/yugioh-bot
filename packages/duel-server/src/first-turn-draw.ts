import type { DuelFormat, DuelMasterRule, DuelMode } from "@yugidraft/shared/duels";

/** Resolve the rule once when a duel starts. MR1/MR2 already draw in the stock core. */
export function firstTurnDrawFor(mode: DuelMode, masterRule: DuelMasterRule = 5): boolean {
  return mode === "domain" || masterRule <= 2;
}

/**
 * A resource pin does not identify the server draw rule. Deployed 1v1/Tag duels used
 * the stock Master Rule flags in both modes. d4338a2 and 42e66c3 were not deployed.
 * FFA used different rules before and after 0fb46df with the same pin in both modes:
 * refuse to guess for an old FFA record.
 */
export function savedFirstTurnDraw(
  stored: unknown,
  _mode: DuelMode,
  masterRule: DuelMasterRule = 5,
  format: DuelFormat = "1v1",
): boolean {
  if (stored !== undefined) {
    if (typeof stored !== "boolean") throw new Error("Saved first-turn draw rule must be a boolean.");
    return stored;
  }
  if (masterRule <= 2) return true;
  if (format === "1v1" || format === "tag") return false;
  throw new Error("The first-turn draw rule was not saved for this duel. Its old rule cannot be determined safely; recovery and replay are unavailable.");
}
