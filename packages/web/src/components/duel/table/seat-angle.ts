/**
 * Pure angle rules of a seat field. A field is turned by its seat angle (degrees, clockwise, 0 = the viewer side).
 * Labels, stats and badges counter-rotate so they stay readable. The card art turns half way when the field is
 * more than a quarter turn off, so a card reads upright for the viewer.
 */

/** An angle in the range -180 to 180. */
export function normalizeDeg(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** True when upright is on and the field is more than a quarter turn off: the art turns half way. */
export function isStraight(angleDeg: number, upright: boolean): boolean {
  return upright && Math.abs(normalizeDeg(angleDeg)) > 90;
}

/**
 * The turn of a label on a seat field, in degrees. Upright on: the exact counter-rotation, so the label is
 * level on screen. Upright off: the nearest quarter turn (a label reads better turned a quarter than at 158°).
 */
export function labelTurnDeg(angleDeg: number, upright: boolean): number {
  const r = normalizeDeg(angleDeg);
  if (upright) return Math.abs(r) < 0.05 ? 0 : -r;
  const a = Math.abs(r);
  if (a >= 120) return 180;
  if (a >= 80) return r < 0 ? 90 : -90;
  return 0;
}

/** Text scale of a field drawn at `scale` (1 or more), so small fields keep readable text. */
export function textScale(scale: number): number {
  if (!(scale > 0)) return 1;
  return Math.min(2.3, Math.max(1, 0.9 / scale));
}

/** "#9b7eff" to "155 126 255": the form that `rgb(var(--t) / .5)` needs. */
export function hexToRgbTriplet(hex: string): string {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const n = Number.parseInt(full, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
