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
