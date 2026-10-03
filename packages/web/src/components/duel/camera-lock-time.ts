/** A short hold after the camera arrives at the play view, so the effect is seen before the camera leaves. */
export const CAMERA_HOLD_MS = 250;

/**
 * Real milliseconds an FX camera lock of `ms` FX milliseconds lasts at the viewer's pace (`duelFxClock.factor()`).
 * The effects run 1/speed as long, but the camera moves (CSS transitions, the fly tween, the roof ease) are not
 * scaled. So a faster pace never cuts the lock below `homeMs` (the home move) plus a short hold, and never below
 * what the lock asked for when that is already shorter. A slower pace stretches the lock as the effects stretch.
 */
export function scaleLockMs(ms: number, speed: number, homeMs = 0): number {
  if (!Number.isFinite(speed) || speed <= 0) return ms;
  const floor = Math.min(ms, homeMs + CAMERA_HOLD_MS);
  return Math.max(Math.round(ms / speed), floor);
}
