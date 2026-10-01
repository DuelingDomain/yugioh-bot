/** Turn timer choices for a duel. 0 seconds is stored for "Unlimited": no clock runs and nobody loses on time. */
export const UNLIMITED_TURN_LABEL = "Unlimited";

export function turnTimerLabel(turnSeconds: number): string {
  if (turnSeconds === 0) return UNLIMITED_TURN_LABEL;
  if (turnSeconds % 60 === 0) return `${turnSeconds / 60} ${turnSeconds === 60 ? "minute" : "minutes"} per turn`;
  return `${turnSeconds} seconds per turn`;
}

export const TURN_TIMER_CHOICES = [0, 60, 120, 180, 240, 300, 600].map((value) => ({ value, label: turnTimerLabel(value) }));
