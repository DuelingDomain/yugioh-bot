/**
 * Timing for card movement on the board ("move" events), shared by MoveFx (draws the flight),
 * SummonFx (starts its effect when the card lands) and the toast layer (holds its sound and banner
 * until the card lands).
 *
 * The plan is a pure function of the fresh events, the clock and the measured distance, and it is
 * memoised per event id, so whichever layer sees a batch first plans it and the others read it.
 *
 * Human pacing (Master Duel / Hearthstone speed): a card placed from the hand takes 480-600 ms, a
 * toss into a pile 460-580 ms, a draw about 520 ms, a card returned to the hand 500 ms, a card
 * taken back from a pile (search, salvage) 680 ms. Moves queue one after another; the next one
 * starts when the previous one is 70% through (never less than minGapMs later, so two draws stay
 * two cards). A long burst is compressed, never skipped, so the whole queue trails no more than
 * about 3 s, and no flight is squeezed below 55% of its length.
 */
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import {
  LOCATION_DECK,
  LOCATION_EXTRA,
  LOCATION_GRAVE,
  LOCATION_HAND,
  LOCATION_REMOVED,
  zoneKey,
} from "./constants";
import { battleBreakIs3d, battleDestroyAt, BREAK_SETTLE_MS, HELD_CRACK_MS } from "./battle-hold";
import { findZoneElement, isHeavySummon, summonStyleOf } from "./event-queue";

export const MOVE_TIMING = {
  placeMin: 480,
  placeMax: 600,
  tossMin: 460,
  tossMax: 580,
  draw: 520,
  ret: 500,
  /** A card taken from the Graveyard or banished pile into the hand: it lifts out, shows its face, then settles. */
  search: 680,
  reduced: 150,
  /** The next move starts when the previous one is this far through. */
  overlap: 0.7,
  /** The next move never starts sooner than this after the previous one (a sped-up burst still reads as separate cards). */
  minGapMs: 180,
  /** The whole queue should finish within this many ms of the newest batch arriving. */
  queueCapMs: 3000,
  /** Never speed a burst up by more than this factor (1 / minSpeed). */
  minSpeed: 0.55,
  /** Destroy: the card cracks and breaks in place first, then flies off. */
  destroyBreakMs: 260,
  destroyBreakBattleMs: 460,
  /** A heavy or typed summon's ghost stays this long after landing so the effect can take over from it. */
  heavyHoldMs: 160,
} as const;

export type MoveStyle = "place" | "toss" | "draw" | "return" | "search" | "fade";

export type MovePlan = {
  /** The move event's id. */
  id: number;
  event: DuelEvent;
  style: MoveStyle;
  /** performance.now() timestamps. */
  startAt: number;
  landAt: number;
  durationMs: number;
  /** Destroy hand-off: ms the card cracks in place before `startAt` (already inside `startAt`). */
  leadMs: number;
  /** Extra ms the ghost stays after landing (heavy summons). */
  holdMs: number;
  /** Ids of the summon/set/activate/destroy events this flight stands in for. */
  pairedIds: number[];
  reduced: boolean;
  /** Where the card was when the move arrived (the board has already moved on by the time it flies). */
  source: ZoneSnapshot | null;
};

export type MoveGeometry = { distance: number };

const plans = new Map<number, MovePlan>();
/** follow-up event id (summon/set/activate/destroy) -> the move plan that carries it. */
const pairs = new Map<number, number>();
const state = { key: "", nextStartAt: 0 };

export function resetMoveSchedule(key = ""): void {
  plans.clear();
  pairs.clear();
  state.key = key;
  state.nextStartAt = 0;
}

export function getMovePlan(id: number): MovePlan | null {
  return plans.get(id) ?? null;
}

/** The flight that stands in for this summon/set/activate/destroy event, if it was planned. */
export function pairedMovePlan(eventId: number): MovePlan | null {
  const moveId = pairs.get(eventId);
  return moveId == null ? null : (plans.get(moveId) ?? null);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sameZone(a: DuelZoneRef | undefined, b: DuelZoneRef | undefined): boolean {
  if (!a || !b) return false;
  return a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;
}

export function isMoveEvent(event: DuelEvent): boolean {
  return event.kind === "move" && event.zone != null && event.from != null;
}

function isPileLocation(location: number): boolean {
  return location === LOCATION_GRAVE || location === LOCATION_REMOVED || location === LOCATION_DECK || location === LOCATION_EXTRA;
}

export function moveStyleOf(event: DuelEvent, reduced: boolean): MoveStyle {
  if (reduced) return "fade";
  const from = event.from;
  const to = event.zone;
  if (!from || !to) return "place";
  if (event.reason === "draw") return "draw";
  if (from.location === LOCATION_DECK && to.location === LOCATION_HAND) return "draw";
  if (isPileLocation(to.location)) return "toss";
  if (to.location === LOCATION_HAND) return from.location === LOCATION_GRAVE || from.location === LOCATION_REMOVED ? "search" : "return";
  return "place";
}

export function baseDuration(style: MoveStyle, distance: number): number {
  const d = Math.max(0, distance);
  switch (style) {
    case "fade":
      return MOVE_TIMING.reduced;
    case "draw":
      return MOVE_TIMING.draw;
    case "return":
      return MOVE_TIMING.ret;
    case "search":
      return MOVE_TIMING.search;
    case "toss":
      return clamp(MOVE_TIMING.tossMin + d * 0.1, MOVE_TIMING.tossMin, MOVE_TIMING.tossMax);
    default:
      return clamp(MOVE_TIMING.placeMin + d * 0.14, MOVE_TIMING.placeMin, MOVE_TIMING.placeMax);
  }
}

type Candidate = {
  event: DuelEvent;
  style: MoveStyle;
  base: number;
  lead: number;
  hold: number;
  /** A battle holds this destroy: the flight starts no earlier than this (performance.now(), 0 = free). */
  notBefore: number;
  paired: number[];
  source: ZoneSnapshot | null;
};

/** Where a card was: the last snapshot of its anchor, else the anchor as it is now. */
export function resolveSource(zone: DuelZoneRef): ZoneSnapshot | null {
  const snap = getZoneSnapshot(zone);
  if (snap) return snap;
  const live = findZoneElement(zone);
  if (!live) return null;
  const r = live.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  return {
    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    side: live.dataset.side === "opp" ? "opp" : "you",
    faceUp: live.querySelector("img") != null,
    defense: live.dataset.defense === "true",
  };
}

/** Distance between the source and destination anchors, from the live board. */
export function measureGeometry(event: DuelEvent): MoveGeometry | null {
  const to = findZoneElement(event.zone);
  if (!to) return null;
  const toRect = to.getBoundingClientRect();
  if (toRect.width < 4) return null;
  const fromRect = event.from ? resolveSource(event.from)?.rect : null;
  if (!fromRect) return { distance: 240 };
  const dx = fromRect.left + fromRect.width / 2 - (toRect.left + toRect.width / 2);
  const dy = fromRect.top + fromRect.height / 2 - (toRect.top + toRect.height / 2);
  return { distance: Math.hypot(dx, dy) };
}

export type PlanOptions = {
  now: number;
  reduced: boolean;
  duelKey: string;
  /** Distance source; defaults to measuring the DOM. Return null to skip a move (no anchor on the board). */
  geometry?: (event: DuelEvent) => MoveGeometry | null;
};

/**
 * Plans every move event in `fresh` that has no plan yet and returns the new plans in engine order.
 * Safe to call again with the same batch: already planned moves are skipped.
 */
export function planMoves(fresh: readonly DuelEvent[], options: PlanOptions): MovePlan[] {
  const { now, reduced, duelKey } = options;
  const geometry = options.geometry ?? measureGeometry;
  if (state.key !== duelKey) resetMoveSchedule(duelKey);
  for (const [id, plan] of plans) {
    if (plan.landAt + plan.holdMs < now - 15000) {
      plans.delete(id);
      for (const paired of plan.pairedIds) pairs.delete(paired);
    }
  }

  const candidates: Candidate[] = [];
  const claimed = new Set<number>();
  for (let i = 0; i < fresh.length; i += 1) {
    const event = fresh[i];
    if (!isMoveEvent(event) || plans.has(event.id)) continue;
    const from = event.from as DuelZoneRef;
    const to = event.zone as DuelZoneRef;
    if (sameZone(from, to)) continue;
    const geo = geometry(event);
    if (!geo) continue;
    let style = moveStyleOf(event, reduced);
    const paired: number[] = [];
    let lead = 0;
    let hold = 0;
    let notBefore = 0;

    // The summon, set or activation this card lands for.
    for (let j = i + 1; j < fresh.length && j <= i + 8; j += 1) {
      const next = fresh[j];
      if (claimed.has(next.id) || pairs.has(next.id)) continue;
      if ((next.kind === "summon" || next.kind === "set" || next.kind === "activate") && sameZone(next.zone, to)) {
        paired.push(next.id);
        claimed.add(next.id);
        if ((isHeavySummon(next) || summonStyleOf(next, from.location) != null) && !reduced) hold = MOVE_TIMING.heavyHoldMs;
        break;
      }
    }
    // The destruction this card flies off from: it cracks in place, then goes to the pile.
    for (const other of fresh) {
      if (other.kind !== "destroy" || claimed.has(other.id) || pairs.has(other.id)) continue;
      if (!sameZone(other.zone, from) || other.card == null || other.card.code <= 0) continue;
      paired.push(other.id);
      claimed.add(other.id);
      lead = reduced ? 0 : other.cause === "battle" ? MOVE_TIMING.destroyBreakBattleMs : MOVE_TIMING.destroyBreakMs;
      // A fight that killed the card is still playing: it breaks only after the last strike landed.
      notBefore = battleDestroyAt(other.zone, now);
      if (notBefore > 0) lead = reduced ? 0 : HELD_CRACK_MS;
      // The 3D layer breaks the card into shards: the pile receives it after they fell, no flight.
      if (notBefore > 0 && battleBreakIs3d(other.zone, now)) {
        notBefore += BREAK_SETTLE_MS;
        lead = 0;
        style = "fade";
      }
      break;
    }
    candidates.push({ event, style, base: baseDuration(style, geo.distance), lead, hold, notBefore, paired, source: resolveSource(from) });
  }
  if (candidates.length === 0) return [];

  const t0 = Math.max(now, state.nextStartAt);
  const place = (speed: number) => {
    let cursor = t0;
    const out: Array<{ start: number; dur: number }> = [];
    for (const item of candidates) {
      const dur = item.base * speed;
      const start = Math.max(cursor + item.lead, item.notBefore);
      out.push({ start, dur });
      cursor = start + Math.max(dur * MOVE_TIMING.overlap, MOVE_TIMING.minGapMs);
    }
    return { out, cursor };
  };
  let speed = 1;
  let layout = place(speed);
  const finishOf = (l: ReturnType<typeof place>) => {
    const last = l.out[l.out.length - 1];
    return last.start + last.dur;
  };
  // Time spent waiting for a battle is not a backlog to squeeze: measure from the latest hold.
  const floor = candidates.reduce((max, item) => Math.max(max, item.notBefore), now);
  const span = finishOf(layout) - floor;
  if (span > MOVE_TIMING.queueCapMs) {
    const fixed = candidates.reduce((sum, item) => sum + item.lead, 0);
    const variable = span - fixed;
    speed = clamp((MOVE_TIMING.queueCapMs - fixed) / Math.max(1, variable), MOVE_TIMING.minSpeed, 1);
    layout = place(speed);
  }

  const created: MovePlan[] = [];
  candidates.forEach((item, index) => {
    const { start, dur } = layout.out[index];
    const plan: MovePlan = {
      id: item.event.id,
      event: item.event,
      style: item.style,
      startAt: start,
      landAt: start + dur,
      durationMs: dur,
      leadMs: item.lead,
      holdMs: item.hold,
      pairedIds: item.paired,
      reduced,
      source: item.source,
    };
    plans.set(plan.id, plan);
    for (const id of item.paired) pairs.set(id, plan.id);
    created.push(plan);
  });
  state.nextStartAt = layout.cursor;
  return created;
}

/* ---------- zone snapshots ----------
 * By the time a move event arrives the board already shows the new state: the card has left its
 * hand slot or zone. A short-interval snapshot of every anchor lets the flight start where the card
 * really was. */

export type ZoneSnapshot = {
  rect: { left: number; top: number; width: number; height: number };
  side: "you" | "opp";
  /** The anchor showed a card image (own hand, face-up card) rather than a sleeve. */
  faceUp: boolean;
  defense: boolean;
};

const snapshots = new Map<string, ZoneSnapshot>();
const handRails = new Map<string, ZoneSnapshot>();

export function captureZoneSnapshots(root: ParentNode = document): void {
  const seen = new Set<string>();
  root.querySelectorAll<HTMLElement>("[data-zones]").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const snap: ZoneSnapshot = {
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      side: el.dataset.side === "opp" ? "opp" : "you",
      faceUp: el.querySelector("img") != null,
      defense: el.dataset.defense === "true",
    };
    for (const key of (el.dataset.zones ?? "").split(/\s+/)) {
      if (!key) continue;
      snapshots.set(key, snap);
      seen.add(key);
    }
  });
  root.querySelectorAll<HTMLElement>("[data-hand-seat]").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    handRails.set(el.dataset.handSeat ?? "", {
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      side: "you",
      faceUp: false,
      defense: false,
    });
  });
}

export function getZoneSnapshot(zone: DuelZoneRef): ZoneSnapshot | null {
  const exact = snapshots.get(zoneKey(zone.controller, zone.location, zone.sequence));
  if (exact) return exact;
  if (zone.location === LOCATION_HAND) {
    const rail = handRails.get(String(zone.controller));
    if (rail) {
      const h = rail.rect.height;
      const w = h * 0.686;
      return {
        ...rail,
        rect: { left: rail.rect.left + rail.rect.width / 2 - w / 2, top: rail.rect.top, width: w, height: h },
      };
    }
  }
  return null;
}

/** Keeps the snapshots fresh while the board is showing. Returns the stop function. */
export function startZoneSnapshots(): () => void {
  if (typeof window === "undefined") return () => undefined;
  captureZoneSnapshots();
  const tick = () => {
    if (!document.hidden) captureZoneSnapshots();
  };
  const timer = window.setInterval(tick, 160);
  // A click on a hand card is followed by the server's answer: capture the layout as it was pressed.
  window.addEventListener("pointerdown", tick, true);
  window.addEventListener("resize", tick);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("pointerdown", tick, true);
    window.removeEventListener("resize", tick);
  };
}
