import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import {
  isDefense,
  isFacedown,
  LOCATION_EXTRA,
  TYPE_FUSION,
  TYPE_LINK,
  TYPE_MONSTER,
  TYPE_SYNCHRO,
  TYPE_XYZ,
  zoneKey,
} from "./constants";

export type DuelEventKind = DuelEvent["kind"];

/** Level or Rank at which a summon counts as heavy (holographic rise, slam, field shake). */
export const HEAVY_SUMMON_LEVEL = 7;
/** Link Rating at which a Link Summon counts as heavy. */
export const HEAVY_LINK_RATING = 3;

/** The Extra Deck and Ritual/Pendulum summon families that get an animation of their own. */
export type SummonStyle = "fusion" | "synchro" | "xyz" | "link" | "ritual" | "pendulum";

const SUMMON_STYLES: readonly SummonStyle[] = ["fusion", "synchro", "xyz", "link", "ritual", "pendulum"];

function isMonsterCard(event: DuelEvent): boolean {
  const card = event.card;
  if (card == null || card.code <= 0) return false;
  return card.type === 0 || (card.type & TYPE_MONSTER) !== 0;
}

/**
 * A summon that deserves weight: a Level/Rank 7+ monster, a Link 3+ monster (its `level` carries
 * the Link Rating), or any Tribute Summon. Needs a public card; a hidden or missing card never counts.
 */
export function isHeavySummon(event: DuelEvent): boolean {
  if (event.kind !== "summon" || !isMonsterCard(event)) return false;
  const card = event.card!;
  if (event.summonKind === "tribute") return true;
  if ((card.type & TYPE_LINK) !== 0) return card.level >= HEAVY_LINK_RATING;
  return card.level >= HEAVY_SUMMON_LEVEL;
}

/**
 * Which summon family an event belongs to. The server names it in `summonKind`; when an older
 * server only says "special", a monster arriving from the Extra Deck is read from its card type.
 * Ritual and Pendulum cannot be told apart from other Special Summons that way, so they need the name.
 */
export function summonStyleOf(event: DuelEvent, fromLocation?: number): SummonStyle | null {
  if (event.kind !== "summon" || !isMonsterCard(event)) return null;
  const kind = event.summonKind as string | undefined;
  if (kind && (SUMMON_STYLES as readonly string[]).includes(kind)) return kind as SummonStyle;
  if (kind !== "special" || fromLocation !== LOCATION_EXTRA) return null;
  const type = event.card!.type;
  if ((type & TYPE_LINK) !== 0) return "link";
  if ((type & TYPE_XYZ) !== 0) return "xyz";
  if ((type & TYPE_SYNCHRO) !== 0) return "synchro";
  if ((type & TYPE_FUSION) !== 0) return "fusion";
  return null;
}

/* ---------- position changes ---------- */

/** A "position" event: a monster turned between Attack and Defense and/or was flipped. */
export type PositionEvent = DuelEvent & {
  zone: DuelZoneRef;
  fromPosition: number;
  toPosition: number;
  /** face-down to face-up. */
  flip?: boolean;
};

export function isPositionEvent(event: DuelEvent): event is PositionEvent {
  if ((event.kind as string) !== "position" || event.zone == null) return false;
  const raw = event as Partial<PositionEvent>;
  return typeof raw.fromPosition === "number" && typeof raw.toPosition === "number";
}

export type PositionChange = {
  /** Attack to Defense or back. */
  turn: boolean;
  fromDefense: boolean;
  toDefense: boolean;
  /** face-down to face-up. */
  reveal: boolean;
  /** face-up to face-down. */
  conceal: boolean;
};

export function positionChangeOf(event: PositionEvent): PositionChange {
  const fromDefense = isDefense(event.fromPosition);
  const toDefense = isDefense(event.toPosition);
  const fromDown = isFacedown(event.fromPosition);
  const toDown = isFacedown(event.toPosition);
  return {
    turn: fromDefense !== toDefense,
    fromDefense,
    toDefense,
    reveal: event.flip === true || (fromDown && !toDown),
    conceal: !fromDown && toDown,
  };
}

function sameZone(a: DuelZoneRef | undefined, b: DuelZoneRef | undefined): boolean {
  return a != null && b != null && a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;
}

/**
 * A Flip Summon arrives as a "summon" (summonKind "flip") and a "position" reveal for the same zone.
 * One of them must stay quiet: a heavy summon's hologram already lands face-up, so it covers the
 * reveal; otherwise the reveal is the whole animation and the light summon pop is skipped.
 */
export function summonCoveredByFlip(fresh: readonly DuelEvent[], summon: DuelEvent): boolean {
  if (summon.kind !== "summon" || isHeavySummon(summon)) return false;
  return fresh.some((other) => isPositionEvent(other) && positionChangeOf(other).reveal && sameZone(other.zone, summon.zone));
}

export function flipCoveredBySummon(fresh: readonly DuelEvent[], position: PositionEvent): boolean {
  return fresh.some((other) => isHeavySummon(other) && sameZone(other.zone, position.zone));
}

/** Event kinds whose picture is drawn on the board by SummonFx or PositionFx when the zone is known. */
export function isZoneFxKind(kind: DuelEventKind): boolean {
  return kind === "summon" || kind === "set" || kind === "destroy" || (kind as string) === "position";
}

/** Zone element for a board position, or null when the board has no such anchor. */
export function findZoneElement(zone: DuelZoneRef | undefined | null): HTMLElement | null {
  if (!zone || typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(
    `[data-zones~="${zoneKey(zone.controller, zone.location, zone.sequence)}"]`,
  );
}

/**
 * True when SummonFx/PositionFx will show this event on the board, so the centre toast stays out of
 * its way. Reduced motion keeps the toast: the board effect is only a short glow.
 */
export function isDrawnOnBoard(event: DuelEvent, reducedMotion: boolean): boolean {
  if (reducedMotion || !isZoneFxKind(event.kind)) return false;
  if (event.kind === "destroy" && (event.card == null || event.card.code <= 0)) return false;
  return findZoneElement(event.zone) != null;
}

/** True when the board effect for this event sounds its own cues (the toast layer stays silent). */
export function fxSoundsItself(event: DuelEvent): boolean {
  return event.kind === "destroy" || isHeavySummon(event) || summonStyleOf(event) != null || isPositionEvent(event);
}

/** SummonFx and PositionFx tell the audio layer when their moments land. */
export const DUEL_FX_CUE_EVENT = "yugidraft:duel-fx-cue";
export type DuelFxCue = "holo" | "slam" | "shatter" | "turn" | "flip" | SummonStyle;
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
