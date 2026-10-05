/** Coin presentation timings in FX milliseconds at 1x. Shared with the web coin planner. */
export const COIN_TIMING = {
  fadeInMs: 220,
  airMs: 1_050,
  hop1Ms: 260,
  hop2Ms: 190,
  holdMs: 1_200,
  outroMs: 260,
  reducedFadeMs: 260,
  summaryInMs: 260,
  summaryHoldMs: 1_000,
  summaryOutMs: 260,
  chainLeadMs: 450,
  gapMs: 500,
  /** Real milliseconds added to the client's fallback unlock timer. */
  safetyMarginMs: 1_500,
} as const;

export const COIN_TOSS_MS = COIN_TIMING.fadeInMs + COIN_TIMING.airMs + COIN_TIMING.hop1Ms
  + COIN_TIMING.hop2Ms + COIN_TIMING.holdMs + COIN_TIMING.outroMs;
export const COIN_SUMMARY_MS = COIN_TIMING.summaryInMs + COIN_TIMING.summaryHoldMs + COIN_TIMING.summaryOutMs;

/** The minimum speed allowed by the live duel animation speed control (0.5x to 2x). */
export const MIN_DUEL_FX_SPEED = 0.5;

/** Longest ordinary chain beat: activation flip (320ms) and readable face (850ms). */
export const COIN_CHAIN_BEAT_MAX_MS = 1_170;

/**
 * Upper bound for one event's coins and optional summary, in real milliseconds.
 * Long tosses may use shorter compact steps; this bound keeps their full durations.
 * Chain lead, gaps between events and the fallback unlock margin are separate.
 */
export function coinTossDurationMs(count: number, speed: number): number {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("Coin count must be a non-negative safe integer");
  if (!Number.isFinite(speed) || speed <= 0) throw new RangeError("FX speed must be finite and positive");
  return (count * COIN_TOSS_MS + (count > 1 ? COIN_SUMMARY_MS : 0)) / speed;
}
