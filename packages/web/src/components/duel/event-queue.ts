import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { TYPE_MONSTER, zoneKey } from "./constants";

export type DuelEventKind = DuelEvent["kind"];

/** Level or Rank at which a summon counts as heavy (holographic rise, slam, field shake). */
export const HEAVY_SUMMON_LEVEL = 7;

/**
 * A summon that deserves weight: a Level/Rank 7+ monster, or any Tribute Summon.
 * Needs a public card; a hidden or missing card never counts.
 */
export function isHeavySummon(event: DuelEvent): boolean {
  if (event.kind !== "summon") return false;
  const card = event.card;
  if (card == null || card.code <= 0) return false;
  if (card.type !== 0 && (card.type & TYPE_MONSTER) === 0) return false;
  return event.summonKind === "tribute" || card.level >= HEAVY_SUMMON_LEVEL;
}

/** Event kinds whose picture is drawn on the board by SummonFx when the zone is known. */
export function isZoneFxKind(kind: DuelEventKind): boolean {
  return kind === "summon" || kind === "set" || kind === "destroy";
}

/** Zone element for a board position, or null when the board has no such anchor. */
export function findZoneElement(zone: DuelZoneRef | undefined | null): HTMLElement | null {
  if (!zone || typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(
    `[data-zones~="${zoneKey(zone.controller, zone.location, zone.sequence)}"]`,
  );
}

/**
 * True when SummonFx will show this event on the board, so the centre toast stays out of its way.
 * Reduced motion keeps the toast: the board effect is only a short glow.
 */
export function isDrawnOnBoard(event: DuelEvent, reducedMotion: boolean): boolean {
  if (reducedMotion || !isZoneFxKind(event.kind)) return false;
  if (event.kind === "destroy" && (event.card == null || event.card.code <= 0)) return false;
  return findZoneElement(event.zone) != null;
}

/** SummonFx tells the audio layer when its moments land (rise, slam, shatter). */
export const DUEL_FX_CUE_EVENT = "yugidraft:duel-fx-cue";
export type DuelFxCue = "holo" | "slam" | "shatter";
export type DuelFxCueDetail = { cue: DuelFxCue; strength: number };

/** Cap remaining cue time so a burst does not stack full-length playback. */
const CATCH_UP_BUDGET_MS = 1000;
const MIN_CUE_MS = 120;

export function maxEventId(events: readonly DuelEvent[]): number | null {
  let max: number | null = null;
  for (const event of events) {
    if (typeof event.id !== "number") continue;
    if (max == null || event.id > max) max = event.id;
  }
  return max;
}

/**
 * Engine-order events with id > cursor, de-duplicated by id.
 * Cursor advances to the max seen id so polling/reconnect does not replay.
 * Ordinary chain batches are not last-N trimmed; presentation pacing handles backlog.
 */
export function collectFreshEvents(
  events: readonly DuelEvent[],
  cursor: number,
): { nextCursor: number; fresh: DuelEvent[] } {
  const seen = new Set<number>();
  const fresh: DuelEvent[] = [];
  let nextCursor = cursor;
  for (const event of events) {
    if (typeof event.id !== "number" || event.id <= cursor) continue;
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    fresh.push(event);
    if (event.id > nextCursor) nextCursor = event.id;
  }
  fresh.sort((a, b) => a.id - b.id);
  return { nextCursor, fresh };
}

export function cueDuration(kind: DuelEventKind, reducedMotion: boolean): number {
  if (reducedMotion) {
    return kind === "activate" ? 900 : 650;
  }
  switch (kind) {
    case "activate":
      return 1100;
    case "summon":
    case "set":
      return 720;
    case "attack":
      return 620;
    case "destroy":
      return 700;
    case "phase":
      return 900;
    case "chain-resolving":
      return 520;
    case "chain-resolved":
    case "chain-negated":
      return 640;
    case "chain-end":
      return 420;
    default:
      return 600;
  }
}

export function pacedCueDuration(
  kind: DuelEventKind,
  reducedMotion: boolean,
  remainingCount: number,
): number {
  const base = cueDuration(kind, reducedMotion);
  if (remainingCount <= 1) return base;
  return Math.min(base, Math.max(MIN_CUE_MS, Math.floor(CATCH_UP_BUDGET_MS / remainingCount)));
}
