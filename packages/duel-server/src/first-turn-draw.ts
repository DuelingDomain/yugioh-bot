import type { DuelEngineChoice, DuelFormat, DuelMasterRule, DuelMode } from "@yugidraft/shared/duels";

/** Resolve the rule once when a duel starts. 1v1 Domain skips turn 1 at every Master Rule. */
export function firstTurnDrawFor(
  mode: DuelMode,
  masterRule: DuelMasterRule = 5,
  _engine?: DuelEngineChoice,
  format: DuelFormat = "1v1",
): boolean {
  return mode === "domain" ? format !== "1v1" : masterRule <= 2;
}

/**
 * A resource pin does not identify the server draw rule. Deployed 1v1/Tag duels used
 * the stock Master Rule flags in both modes. d4338a2 and 42e66c3 were not deployed.
 * FFA used different rules before and after 0fb46df with the same pin in both modes:
 * refuse to guess for an old FFA record.
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
  // Before the draw flag was saved, every 1v1 engine used the stock Master Rule draw rule (MR1/MR2 only).
  // This also applies to old pinned records.
  if (format === "1v1") return masterRule <= 2;
  if (masterRule <= 2) return true;
  if (format === "tag") return false;
  throw new Error("The first-turn draw rule was not saved for this duel. Its old rule cannot be determined safely; recovery and replay are unavailable.");
}
