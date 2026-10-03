import { fieldPlacementMs } from "../placement-timing";
import type { SummonStyle } from "../event-queue";
import type { DuelShakePreference } from "../preferences";
import { easeInCubic, easeOutCubic, ramp } from "./ease";

/**
 * Timing of a big 3D summon, in ms from its start. The portrait ("embodiment") rises out of the
 * zone between `rise0` and `rise1`, hangs until `holdEnd`, and shrinks back into the card, which
 * the real card replaces at `handOver`. The aftershock plays until `total`.
 */
export type Summon3dKey = SummonStyle | "heavy";

export type Summon3dTimeline = {
  rise0: number;
  rise1: number;
  holdEnd: number;
  handOver: number;
  total: number;
};

export const SUMMON3D_AUTHORED: Record<Summon3dKey, Summon3dTimeline> = {
  fusion: { rise0: 220, rise1: 540, holdEnd: 1100, handOver: 1340, total: 1720 },
  synchro: { rise0: 240, rise1: 560, holdEnd: 1120, handOver: 1360, total: 1740 },
  xyz: { rise0: 260, rise1: 580, holdEnd: 1140, handOver: 1380, total: 1760 },
  link: { rise0: 180, rise1: 480, holdEnd: 1040, handOver: 1280, total: 1650 },
  ritual: { rise0: 240, rise1: 560, holdEnd: 1120, handOver: 1360, total: 1740 },
  pendulum: { rise0: 260, rise1: 580, holdEnd: 1140, handOver: 1380, total: 1760 },
  heavy: { rise0: 120, rise1: 400, holdEnd: 960, handOver: 1180, total: 1550 },
};

export const SUMMON3D_TIMELINE = Object.fromEntries(
  Object.entries(SUMMON3D_AUTHORED).map(([key, tl]) => [key, Object.fromEntries(
    Object.entries(tl).map(([beat, ms]) => [beat, fieldPlacementMs(ms)]),
  )]),
) as Record<Summon3dKey, Summon3dTimeline>;

/** The moment the portrait lands in the card: the slam (shake, cracks, aura) is timed to it. */
export function summon3dHitMs(key: Summon3dKey): number {
  return SUMMON3D_TIMELINE[key].handOver;
}

/** A second big summon may start this long after the first: a beat after the first one landed. */
export function summon3dLockMs(key: Summon3dKey): number {
  return SUMMON3D_TIMELINE[key].handOver + fieldPlacementMs(220);
}

export type EmbodimentStage = "before" | "rise" | "hold" | "shrink" | "landed";

/** Where the portrait is at `ms`: `grow` is 0 when it sits on the card and 1 when it is fully open. */
export function embodimentAt(tl: Summon3dTimeline, ms: number): { stage: EmbodimentStage; grow: number } {
  if (ms < tl.rise0) return { stage: "before", grow: 0 };
  if (ms < tl.rise1) return { stage: "rise", grow: easeOutCubic(ramp(ms, tl.rise0, tl.rise1)) };
  if (ms < tl.holdEnd) return { stage: "hold", grow: 1 };
  if (ms < tl.handOver) return { stage: "shrink", grow: 1 - easeInCubic(ramp(ms, tl.holdEnd, tl.handOver)) };
  return { stage: "landed", grow: 0 };
}

/** Movement scale of the 3D field effects for a shake preference ("off" keeps the light, drops the movement). */
export function shakeScaleOf(pref: DuelShakePreference): number {
  switch (pref) {
    case "off":
      return 0;
    case "low":
      return 0.5;
    case "high":
      return 1.6;
    default:
      return 1;
  }
}
