import type { SceneCueName } from "./fx3d/scene-plan";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import type { BattleSoundPlan } from "./attack-audio";
import {
  isDefenseAt,
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
/** ATK at which any monster counts as heavy, whatever its Level. */
export const HEAVY_ATTACK = 2500;

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
 * the Link Rating), a monster with 2500+ ATK, or any Tribute Summon. Needs a public card; a hidden
 * or missing card never counts.
 */
export function isHeavySummon(event: DuelEvent): boolean {
  if (event.kind !== "summon" || !isMonsterCard(event)) return false;
  const card = event.card!;
  if (event.summonKind === "tribute") return true;
  if (typeof card.attack === "number" && card.attack >= HEAVY_ATTACK) return true;
  if ((card.type & TYPE_LINK) !== 0) return card.level >= HEAVY_LINK_RATING;
  return card.level >= HEAVY_SUMMON_LEVEL;
}

/* ---------- slam: how hard a strong monster lands ---------- */

export const SLAM_MIN_STRENGTH = 0.6;
export const SLAM_MAX_STRENGTH = 1.6;

/**
 * How hard a summon lands on the board, 0 when it does not slam. Every heavy summon slams
 * (Tribute, Level/Rank 7+, Link 3+, 2500+ ATK) and so does every typed summon (Fusion, Synchro,
 * Xyz, Link, Ritual, Pendulum). Strength runs from 0.6 to 1.6 and grows with Level/Rank, ATK, a
 * Tribute Summon and the summon type. It sets the shake, the jolt of the neighbours, the number and
 * length of the cracks, and the size of the aura.
 */
export function slamStrengthOf(event: DuelEvent, fromLocation?: number): number {
  const heavy = isHeavySummon(event);
  const typed = summonStyleOf(event, fromLocation) != null;
  if (!heavy && !typed) return 0;
  const card = event.card!;
  let strength = SLAM_MIN_STRENGTH;
  const level = (card.type & TYPE_LINK) !== 0 ? card.level * 2 + 1 : card.level;
  if (level >= HEAVY_SUMMON_LEVEL) strength += Math.min(0.45, 0.1 + (level - HEAVY_SUMMON_LEVEL) * 0.08);
  const attack = typeof card.attack === "number" ? card.attack : 0;
  if (attack >= HEAVY_ATTACK) strength += Math.min(0.4, 0.1 + ((attack - HEAVY_ATTACK) / 2500) * 0.3);
  if (event.summonKind === "tribute") strength += 0.05;
  if (typed) strength += 0.08;
  return Math.round(Math.min(SLAM_MAX_STRENGTH, Math.max(SLAM_MIN_STRENGTH, strength)) * 100) / 100;
}

export type SlamTier = 1 | 2 | 3;

export function slamTierOf(strength: number): SlamTier {
  return strength < 0.85 ? 1 : strength < 1.2 ? 2 : 3;
}

/** Number of main cracks on the field for a slam of this strength (more and longer as it grows). */
export function slamCrackCount(strength: number): number {
  return Math.round(5 + strength * 4);
}

/** Aura colours by card attribute bit, as "r g b" (main, secondary). */
const ATTRIBUTE_TINT: Array<[number, [string, string]]> = [
  [0x01, ["214 164 96", "150 104 58"]],
  [0x02, ["96 176 255", "50 110 230"]],
  [0x04, ["255 132 70", "230 60 40"]],
  [0x08, ["130 236 170", "60 190 130"]],
  [0x10, ["255 244 184", "244 214 120"]],
  [0x20, ["184 120 255", "110 60 200"]],
  [0x40, ["255 216 110", "230 150 40"]],
];

/** Gold and purple: the aura of a card that has no attribute. */
export const DEFAULT_AURA_TINT: [string, string] = ["244 214 144", "155 126 255"];

export function auraTintOf(attribute: number | null | undefined): [string, string] {
  if (!attribute) return DEFAULT_AURA_TINT;
  const hit = ATTRIBUTE_TINT.find(([bit]) => (attribute & bit) !== 0);
  return hit ? hit[1] : DEFAULT_AURA_TINT;
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
  const fromDefense = isDefenseAt(event.zone.location, event.fromPosition);
  const toDefense = isDefenseAt(event.zone.location, event.toPosition);
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
export type DuelFxCue = "holo" | "slam" | "shatter" | "turn" | "flip" | "battle" | SceneCueName | SummonStyle;
/** `battle` carries the plan of the fight (BattleFx sends it when a fight starts playing). */
export type DuelFxCueDetail = { cue: DuelFxCue; strength: number; battle?: BattleSoundPlan };

export function emitDuelFxCue(detail: DuelFxCueDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DuelFxCueDetail>(DUEL_FX_CUE_EVENT, { detail }));
}

/**
 * A backlog of cues is compressed, never dropped: each cue keeps at least MIN_CUE_FRACTION of its
 * length (and MIN_CUE_MS), so a long chain stays a row of distinct beats instead of a blur.
 */
const CATCH_UP_BUDGET_MS = 3600;
const MIN_CUE_MS = 400;
const MIN_CUE_FRACTION = 0.5;
/**
 * Past this, a backlog would trail the board by more and more (the floor above times the queue
 * length), so the floor gives way and the whole queue fits in about this long, down to BLINK_CUE_MS.
 */
const MAX_BACKLOG_MS = 7000;
const BLINK_CUE_MS = 250;

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

/** How long a banner or toast stays: at least about 1.2 s for anything with words to read. */
export function cueDuration(kind: DuelEventKind, reducedMotion: boolean): number {
  if (reducedMotion) {
    return kind === "activate" ? 1200 : 900;
  }
  switch (kind) {
    case "activate":
      return 1500;
    case "summon":
    case "set":
    case "attack":
    case "destroy":
    case "phase":
      return 1200;
    case "chain-resolving":
      return 800;
    case "chain-resolved":
    case "chain-negated":
      return 900;
    default:
      return 900;
  }
}

export function pacedCueDuration(
  kind: DuelEventKind,
  reducedMotion: boolean,
  remainingCount: number,
): number {
  const base = cueDuration(kind, reducedMotion);
  if (remainingCount <= 1) return base;
  const floor = Math.min(
    base,
    Math.max(MIN_CUE_MS, Math.round(base * MIN_CUE_FRACTION)),
    Math.max(BLINK_CUE_MS, Math.floor(MAX_BACKLOG_MS / remainingCount)),
  );
  return Math.min(base, Math.max(floor, Math.floor(CATCH_UP_BUDGET_MS / remainingCount)));
}
