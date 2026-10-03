import type { DuelEngineView, DuelPrompt } from "@yugidraft/shared/duels";
import { isEliminated, nextSeatAfter } from "../multi-seat";
import { optionZoneKeys } from "../prompts";
import type { CameraState, SeatStatus, TargetChoice } from "./types";

/**
 * What the viewer can aim at, grouped by the rival seat that holds it. Zone options (attack target, target pick)
 * give zone keys; an option that has a seat but no zone (a direct attack, an opponent pick) hits that seat's LP.
 * Empty unless the prompt is the live viewer's own. Leaving targets remain available until eliminated.
 */
export function targetChoices(
  prompt: DuelPrompt | null,
  engine: Pick<DuelEngineView, "seats">,
  viewerSeat: number | null,
  nameOf: (seat: number) => string = (seat) => `Player ${seat + 1}`,
): TargetChoice[] {
  if (!prompt || viewerSeat == null || prompt.seat !== viewerSeat) return [];
  const viewer = engine.seats.find((entry) => entry.seat === viewerSeat);
  if (isEliminated(viewer) || viewer?.pendingElimination === true) return [];
  const bySeat = new Map<number, { zones: string[]; direct: boolean; optionIds: string[] }>();
  for (const option of prompt.options) {
    const seat = option.controller;
    if (seat == null || seat === viewerSeat) continue;
    const view = engine.seats.find((entry) => entry.seat === seat);
    if (!view || isEliminated(view)) continue;
    const entry = bySeat.get(seat) ?? { zones: [], direct: false, optionIds: [] };
    const keys = optionZoneKeys(option);
    if (keys.length === 0) entry.direct = true;
    else entry.zones.push(...keys);
    entry.optionIds.push(option.id);
    bySeat.set(seat, entry);
  }
  return [...bySeat.entries()]
    .sort(([a], [b]) => a - b)
    .map(([seat, entry]) => ({ seat, zones: entry.zones, direct: entry.direct, optionIds: entry.optionIds, label: nameOf(seat) }));
}

/** The seat to aim at when the player did not pick one: the focused rival if it has a choice, else the only choice. */
export function defaultTargetSeat(choices: readonly TargetChoice[], camera: Pick<CameraState, "focusSeat">): number | null {
  if (camera.focusSeat != null && choices.some((choice) => choice.seat === camera.focusSeat)) return camera.focusSeat;
  return choices.length === 1 ? choices[0].seat : null;
}

/** The state of a seat on the turn ring and the LP panels. */
export function seatStatus(engine: Pick<DuelEngineView, "seats" | "turnSeat">, seat: number, promptSeat: number | null): SeatStatus {
  const view = engine.seats.find((entry) => entry.seat === seat);
  if (isEliminated(view)) return "eliminated";
  if (view?.pendingElimination === true) return "leaving";
  if (promptSeat === seat && engine.turnSeat !== seat) return "choosing";
  if (engine.turnSeat === seat) return "turn";
  if (nextSeatAfter(engine.seats, engine.turnSeat) === seat) return "next";
  return "active";
}

/** Follow a field only when a prompt needs its targets. Eliminations alone leave the table view stable. */
export function autoFollowSeat(
  choices: readonly TargetChoice[],
  engine: Pick<DuelEngineView, "seats">,
  viewerSeat: number | null,
): { seat: number; reason: string } | null {
  if (viewerSeat == null) return null;
  if (choices.length !== 1 || choices[0].zones.length === 0) return null;
  const view = engine.seats.find((seat) => seat.seat === choices[0].seat);
  return view && !isEliminated(view) ? { seat: view.seat, reason: "Pick a target" } : null;
}
