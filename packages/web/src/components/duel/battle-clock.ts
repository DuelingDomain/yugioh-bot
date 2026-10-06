import { coinBarrierFor } from "./coin-barrier";
import { duelFxClock } from "./fx-clock";

/** The initial catch-up must leave the wind-up visible even after a slow frame. */
export const BATTLE_SEEK_MAX_MS = 120;

/** Shared by playback and the holds armed before React commits the new board. */
export type BattleClock = { startedAt: number };

export function battleSeekMs(startedAt: number | undefined, now = duelFxClock.now()): number {
  return startedAt == null ? 0 : Math.min(BATTLE_SEEK_MAX_MS, Math.max(0, now - startedAt));
}

/** Rebase once on joining playback; every later beat keeps this same origin. */
export function joinBattleClock(clock: BattleClock, now = duelFxClock.now()): number {
  clock.startedAt = now - battleSeekMs(clock.startedAt, now);
  return clock.startedAt;
}

/**
 * A battle clock whose start may not come before the coin toss that precedes the fight is gone. The start
 * is read when it is needed (never fixed), because the plan of the coin is made after the render pass.
 * `eventId` is the first result event of the fight (battleOutcomeId); null means no coin can hold it.
 */
export function coinHeldClock(startedAt: number, eventId: number | null): BattleClock {
  let base = startedAt;
  return {
    get startedAt() {
      // Only ever later: once the coin has gone, the start stays at the moment it went.
      if (eventId != null) base = Math.max(base, coinBarrierFor(eventId));
      return base;
    },
    set startedAt(value: number) {
      base = value;
    },
  };
}
