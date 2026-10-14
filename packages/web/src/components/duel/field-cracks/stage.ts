/* Field cracks: which stage a field is in, as a pure function of its life points. */

/** Share of the starting LP at or under which stage 1, 2 and 3 begin. */
export const STAGE_THRESHOLDS = [0.5, 0.25, 0.1] as const;
/** How long the cracks of each stage take to spread (ms). Stage 4 is the quick connect right before a field breaks. */
export const SPREAD_MS = { 1: 520, 2: 620, 3: 700, 4: 260 } as const;

export type CrackStage = 0 | 1 | 2 | 3 | 4;

/** 0 = healthy, 1..3 = cracks + crumbling, 4 = out (0 LP or less). */
export function crackStage(lp: number | null | undefined, startLp: number | null | undefined): CrackStage {
  if (lp == null || startLp == null || !(startLp > 0)) return 0;
  if (lp <= 0) return 4;
  const f = lp / startLp;
  return f <= STAGE_THRESHOLDS[2] ? 3 : f <= STAGE_THRESHOLDS[1] ? 2 : f <= STAGE_THRESHOLDS[0] ? 1 : 0;
}

/** What a stage that goes back down does: "keep" holds the highest stage reached (default); "mend" follows the LP. */
export type RegainMode = "keep" | "mend";

/** The stage to show now, given the one shown before and the stage the LP says. */
export function nextStage(shown: CrackStage, lpStage: CrackStage, mode: RegainMode): CrackStage {
  return mode === "keep" ? (Math.max(shown, lpStage) as CrackStage) : lpStage;
}
