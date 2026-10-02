import type { DuelFormat, DuelMasterRule, DuelMode } from "@yugidraft/shared/duels";

/** Resolve the rule once when a duel starts. MR1/MR2 already draw in the stock core. */
export function firstTurnDrawFor(mode: DuelMode, masterRule: DuelMasterRule = 5): boolean {
  return mode === "domain" || masterRule <= 2;
}

/**
 * A resource pin does not identify the server draw rule. Standard 1v1/Tag and MR1/MR2
 * did not change, so those old records have an unambiguous rule. Domain MR3-MR5 and
 * Standard FFA used different rules with the same pin: refuse to guess for them.
 */
export function savedFirstTurnDraw(
  stored: unknown,
  mode: DuelMode,
  masterRule: DuelMasterRule = 5,
  format: DuelFormat = "1v1",
): boolean {
  if (stored !== undefined) {
    if (typeof stored !== "boolean") throw new Error("Saved first-turn draw rule must be a boolean.");
    return stored;
  }
  if (masterRule <= 2) return true;
  if (mode === "normal" && (format === "1v1" || format === "tag")) return false;
  throw new Error("The first-turn draw rule was not saved for this duel. Its old rule cannot be determined safely; recovery and replay are unavailable.");
}
