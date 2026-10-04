import type { DuelFormat, DuelMasterRule, DuelMode } from "@yugidraft/shared/duels";
import { firstTurnDrawFor, savedFirstTurnDraw } from "../../src/first-turn-draw.js";

/** Local failure files have no deployment history. Warn before using the current rule. */
export function savedFuzzFirstTurnDraw(stored: unknown, mode: DuelMode, masterRule: DuelMasterRule = 5, format: DuelFormat = "1v1"): boolean {
  if (stored === undefined) {
    console.warn("Warning: this file has no saved first-turn draw rule; replay uses the current rule.");
    return firstTurnDrawFor(mode, masterRule, undefined, format);
  }
  return savedFirstTurnDraw(stored, mode, masterRule, format);
}
