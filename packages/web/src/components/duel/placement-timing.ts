import type { DuelEvent } from "@yugidraft/shared/duels";
import { LOCATION_FZONE, LOCATION_MZONE, LOCATION_PZONE, LOCATION_SZONE } from "./constants";

/** Baseline field placement is five percent quicker, before the viewer's speed preference. */
export const FIELD_PLACEMENT_SCALE = 0.95;
export const fieldPlacementMs = (ms: number, reduced = false): number => reduced ? ms : ms * FIELD_PLACEMENT_SCALE;

export function isFieldPlacementLocation(location: number): boolean {
  return [LOCATION_MZONE, LOCATION_SZONE, LOCATION_FZONE, LOCATION_PZONE].includes(location);
}

/** A battle reveal or effect position change keeps its original baseline. */
export function isFlipSummonPlacement(event: DuelEvent, fresh: readonly DuelEvent[]): boolean {
  const zone = event.zone;
  return zone != null && fresh.some((other) => other.kind === "summon" && other.summonKind === "flip" &&
    other.zone?.controller === zone.controller && other.zone.location === zone.location && other.zone.sequence === zone.sequence);
}
