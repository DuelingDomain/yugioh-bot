/**
 * Pure angle rules of a seat field. A field is turned by its seat angle (degrees, clockwise, 0 = the viewer side).
 * The cards, labels, stats and badges all turn with it, so everything on a field faces the seat that owns it.
 */

/** An angle in the range -180 to 180. */
export function normalizeDeg(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
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
