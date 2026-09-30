import type { SummonStyle } from "../event-queue";
import type { Fx3dEffectId } from "./types";
import type { Summon3dKey } from "./timeline";

/** Which layer draws a board effect. */
export type SummonRoute = "three" | "dom";

/**
 * The 3D layer draws the big summons only: heavy summons and the typed ones (Fusion, Synchro, Xyz,
 * Link, Ritual, Pendulum). Light summons, sets, activations and destroys stay with the DOM effects.
 * Reduced motion, and any moment the canvas is not ready (still loading, no WebGL, context lost),
 * keep the DOM effect. `ready` is read when the effect is planned, so an effect never switches
 * layer half-way.
 */
export function pickSummonRoute(input: { kind: string; reduced: boolean; ready: boolean }): SummonRoute {
  if (input.reduced || !input.ready) return "dom";
  return input.kind === "heavy" || input.kind === "typed" ? "three" : "dom";
}

/** The 3D effect of a planned summon: the typed style wins, else the plain heavy slam. */
export function summon3dKeyOf(kind: string, style: SummonStyle | null): Summon3dKey | null {
  if (kind !== "heavy" && kind !== "typed") return null;
  return style ?? (kind === "heavy" ? "heavy" : null);
}

export function summonEffectId(key: Summon3dKey): Fx3dEffectId {
  return `summon:${key}`;
}
