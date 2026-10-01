/**
 * A tiny store that says "an LP counter is rolling". The roll runs on requestAnimationFrame, which the
 * board's getAnimations() cannot see, so the counter notes its own end time here (any hold before the
 * roll, plus the roll). The result screen waits for it, so it never covers the last LP roll.
 * Times are Date.now() stamps.
 */

let until = 0;

/** An LP roll starts now (after `ms` of hold and roll in all). */
export function noteLpMotion(ms: number, at: number = Date.now()): void {
  until = Math.max(until, at + ms);
}

/** Time left until every LP counter that rolls has stopped; 0 when none rolls. */
export function lpMotionRemainingMs(at: number = Date.now()): number {
  return Math.max(0, until - at);
}

export function clearLpMotion(): void {
  until = 0;
}
