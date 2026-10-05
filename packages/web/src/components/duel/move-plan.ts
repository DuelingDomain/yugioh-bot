/**
 * Timing for card movement on the board ("move" events), shared by MoveFx (draws the flight),
 * SummonFx (starts its effect when the card lands) and the toast layer (holds its sound and banner
 * until the card lands).
 *
 * The plan is a pure function of the fresh events, the clock and the measured distance, and it is
 * memoised per event id, so whichever layer sees a batch first plans it and the others read it.
 *
 * Human pacing (the numbers live in duel-timing.ts): a card placed from the hand takes 700-860 ms,
 * a toss into a pile 680-840 ms, a draw about 667 ms. A card that an effect adds to a hand (a search,
 * Painful Choice, a salvage, a bounce) is shown: it rises to the middle of the board, is held there
 * (about 720 ms), then flies into the hand (add-to-hand.ts). Moves queue one after another; the next
 * one starts when the previous one is 70% through (never less than minGapMs later, so two draws stay
 * two cards). The next move after a showcase starts when the showcase card sets off for the hand, and
 * the showcases of one effect go first. A long burst is compressed, never skipped, so the whole queue
 * trails no more than about 4.4 s, and no flight is squeezed below 60% of its length (a showcase hold
 * is never under holdMinMs).
 */
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import {
  LOCATION_DECK,
  LOCATION_EXTRA,
  LOCATION_GRAVE,
  LOCATION_HAND,
  LOCATION_MZONE,
  LOCATION_REMOVED,
  LOCATION_SZONE,
  zoneKey,
} from "./constants";
import { battleBreakIs3d, battleDestroyAt, battleTakeover, BREAK_SETTLE_MS, HELD_CRACK_MS } from "./battle-hold";
import { playsBigSummon } from "./big-summon";
import { fieldPlacementMs, isFieldPlacementLocation } from "./placement-timing";
import { MOVE_PACE, TRIBUTE_FLIGHT_MS, TRIBUTE_TIMING } from "./duel-timing";
import { isAddToHand, showcaseGateMs, showcaseOrigin, showcasePhases, type ShowcaseOrigin, type ShowcasePhases } from "./add-to-hand";
import { chainEffectAt } from "./chain-beats";
import { findMoveZoneElement, findMoveDestination, handArrivalTarget, moveDestinationRect } from "./event-queue";
import { artCodeOf } from "./destroy-hide";
import { resetEffectSequence, sequenceEffects } from "./effect-sequence";

export const MOVE_TIMING = {
  placeMin: MOVE_PACE.placeMinMs,
  placeMax: MOVE_PACE.placeMaxMs,
  tossMin: MOVE_PACE.tossMinMs,
  tossMax: MOVE_PACE.tossMaxMs,
  draw: MOVE_PACE.drawMs,
  reduced: MOVE_PACE.reducedMs,
  /** The next move starts when the previous one is this far through. */
  overlap: MOVE_PACE.overlap,
  /** The next move never starts sooner than this after the previous one (a sped-up burst still reads as separate cards). */
  minGapMs: MOVE_PACE.minGapMs,
  handMinGapMs: MOVE_PACE.handMinGapMs,
  handQueueCapMs: MOVE_PACE.handQueueCapMs,
  dealGapMs: MOVE_PACE.dealGapMs,
  dealMs: MOVE_PACE.dealMs,
  dealMinCards: MOVE_PACE.dealMinCards,
  /** The whole queue should finish within this many ms of the newest batch arriving. */
  queueCapMs: MOVE_PACE.queueCapMs,
  /** Never speed a burst up by more than this factor (1 / minSpeed). */
  minSpeed: MOVE_PACE.minSpeed,
  /** Destroy: the card cracks and breaks in place first, then flies off. */
  destroyBreakMs: MOVE_PACE.destroyBreakMs,
  destroyBreakBattleMs: MOVE_PACE.destroyBreakBattleMs,
} as const;

export type MoveStyle = "place" | "toss" | "draw" | "add" | "fade" | "tribute";

/** A Tribute Summon's part in a move: a Tribute that burns into energy, or the monster the energy flows into. */
export type TributeRole =
  | { role: "tribute"; index: number; count: number; to: DuelZoneRef }
  | { role: "summoned"; count: number };

/** The "Added to hand" showcase of a move: where it starts and how long each leg lasts. */
export type ShowcasePlan = {
  origin: ShowcaseOrigin;
  phases: ShowcasePhases;
};

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
  /** Explicit battle/canvas/chain floor, independent of the serial queue's overlap. */
  notBeforeAt?: number;
  /** Extra ms the ghost stays after landing. */
  holdMs: number;
  /** The card is being destroyed: it is hidden in its zone until this flight lands in the pile. */
  destroy: boolean;
  /** A wipe piece drew this card's flight on the canvas: the pile only fades the card in at `startAt`. */
  takeover: boolean;
  /**
   * What the flight draws for a destroyed card instead of the intact card (never a whole card leaving
   * the zone it just broke in): "burst" = pieces that spring apart from the break and fly to the pile;
   * "scattered" = pieces that fade in already apart, after the slice of a fight was seen; null = the
   * card itself (every other move, reduced motion, and the 3D break that already played its shards).
   */
  pieces: "burst" | "scattered" | null;
  /**
   * The flight carries a big summon: nothing is drawn (MoveFx skips it) because the portrait is the
   * arrival, and the real card stays hidden until the slam. `landAt` equals `startAt`, the moment the
   * summon effect starts.
   */
  silent: boolean;
  /** Ids of the summon/set/activate/destroy events this flight stands in for. */
  pairedIds: number[];
  reduced: boolean;
  /** Where the card was when the move arrived (the board has already moved on by the time it flies). */
  source: ZoneSnapshot | null;
  /** An effect added the card to a hand (style "add"): the showcase, then the flight into the hand. */
  showcase: ShowcasePlan | null;
  /** Same-batch hand departure: replace this ghost at landing, without a duplicate or glow. */
  handoff?: number;
  /** The preceding arrival, whose current landing geometry becomes this flight's source. */
  handoffFrom?: DuelEvent;
  /** A Tribute (style "tribute") and the zone of the summon its energy flows into. */
  tribute?: { index: number; count: number; to: DuelZoneRef };
};

export type MoveGeometry = { distance: number };

/**
 * A card that leaves the field for a reason that is not a destroy waits for its flight (the chain, the queue).
 * The board already shows the new state, so its zone is empty: the ghost is placed over the zone at once, in the
 * pose the card had (sleeve or face, Attack or Defense), and lifts from there when its flight starts. The same
 * element stands in and flies, so the card never vanishes and never shows twice. A destroy has its own
 * stand-in (the break in SummonFx), a Tribute and a wipe piece their own layers. Under reduced motion the
 * "fade" plan has a stand-in of its own at the source (MoveFx), destroy or not.
 */
export function standsInAtSource(plan: MovePlan): boolean {
  const from = plan.event.from?.location;
  if (from !== LOCATION_MZONE && from !== LOCATION_SZONE) return false;
  if (plan.source == null || plan.silent || plan.takeover || plan.handoffFrom) return false;
  // Reduced motion: the card does not travel. It stays in its zone, pose and face, and fades out there
  // while it fades in on its pile. A destroy has no break to stand in for it, so it stays too.
  if (plan.reduced && plan.style === "fade" && !plan.tribute) return true;
  if (plan.destroy) return false;
  // A showcase that rises from the zone starts on the card; one that rises from a strip or a pile does not.
  if (plan.style === "add") return plan.showcase?.origin.kind === "source";
  return plan.style !== "tribute" && plan.style !== "fade";
}

const plans = new Map<number, MovePlan>();
/** follow-up event id (summon/set/activate/destroy) -> the move plan that carries it. */
const pairs = new Map<number, number>();
const state = { key: "", nextStartAt: 0 };

/**
 * 3D mode seam: a rule that marks a move silent (nothing drawn, the real card is not hidden by MoveFx) because the
 * 3D mode room draws that arrival itself (the Deck Master hologram). Null in classic, so classic plans are unchanged.
 */
let silentMoveRule: ((event: DuelEvent) => boolean) | null = null;
export function setSilentMoveRule(rule: ((event: DuelEvent) => boolean) | null): void {
  silentMoveRule = rule;
}

export function resetMoveSchedule(key = ""): void {
  resetEffectSequence();
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

/**
 * performance.now() timestamp at which every planned card flight (and its landing hold) is over;
 * `now` when none is running. Effects that must come after the cards have settled (the Deck Master
 * returning to its zone) start then.
 */
export function movesSettleAt(now: number): number {
  let end = now;
  for (const plan of plans.values()) end = Math.max(end, plan.landAt + plan.holdMs);
  return end;
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

/**
 * The moves of Tribute Summons in a batch. A tribute summon reads: the Tributes leave the Monster Zone for the
 * Graveyard, the summoned monster moves onto the field, then the summon event (summonKind "tribute"). Walk back from
 * each such summon over its own move and the Tribute moves that came just before it.
 */
export function tributeRoles(fresh: readonly DuelEvent[]): Map<number, TributeRole> {
  const roles = new Map<number, TributeRole>();
  fresh.forEach((summon, k) => {
    if (summon.kind !== "summon" || summon.summonKind !== "tribute" || !summon.zone) return;
    const released: DuelEvent[] = [];
    let summonedMove: DuelEvent | null = null;
    for (let j = k - 1; j >= 0; j -= 1) {
      const event = fresh[j];
      if (!isMoveEvent(event)) break;
      if (!summonedMove && sameZone(event.zone, summon.zone) && event.from!.location !== LOCATION_MZONE) {
        summonedMove = event;
        continue;
      }
      if (event.from!.location === LOCATION_MZONE && event.zone!.location === LOCATION_GRAVE && event.from!.controller === summon.zone.controller) {
        released.unshift(event);
        continue;
      }
      break;
    }
    if (released.length === 0) return;
    released.forEach((event, index) => roles.set(event.id, { role: "tribute", index, count: released.length, to: summon.zone! }));
    if (summonedMove) roles.set(summonedMove.id, { role: "summoned", count: released.length });
  });
  return roles;
}

function isPileLocation(location: number): boolean {
  return location === LOCATION_GRAVE || location === LOCATION_REMOVED || location === LOCATION_DECK || location === LOCATION_EXTRA;
}

/**
 * A deal: a batch of plain draws from the Deck into hands, like the two opening hands. Its cards leave
 * the Deck one after the other at a short fixed pace (dealGapMs), so a hand fills card by card in about
 * a second. One draw, or a draw effect of a few cards, keeps the ordinary pace.
 */
export function isDealBatch(events: readonly DuelEvent[]): boolean {
  return events.length >= MOVE_TIMING.dealMinCards && events.every((event) => event.reason === "draw"
    && event.from?.location === LOCATION_DECK && event.zone?.location === LOCATION_HAND);
}

export function moveStyleOf(event: DuelEvent, reduced: boolean): MoveStyle {
  // An add to hand keeps its own show under reduced motion (a fade in, a hold, a fade out).
  if (isAddToHand(event)) return "add";
  if (reduced) return "fade";
  const from = event.from;
  const to = event.zone;
  if (!from || !to) return "place";
  if (event.reason === "draw") return "draw";
  if (from.location === LOCATION_DECK && to.location === LOCATION_HAND) return "draw";
  if (isPileLocation(to.location)) return "toss";
  // A card that goes into a hand and is not an add (a hand to hand move) is a short place.
  return "place";
}

export function baseDuration(style: MoveStyle, distance: number, reduced = false, fieldPlacement = true): number {
  const d = Math.max(0, distance);
  switch (style) {
    case "fade":
      return MOVE_TIMING.reduced;
    case "draw":
      return MOVE_TIMING.draw;
    case "add":
      return showcasePhases(1, reduced).totalMs;
    case "toss":
      return clamp(MOVE_TIMING.tossMin + d * 0.1, MOVE_TIMING.tossMin, MOVE_TIMING.tossMax);
    case "tribute":
      return TRIBUTE_FLIGHT_MS;
    default:
      return fieldPlacementMs(clamp(MOVE_TIMING.placeMin + d * 0.14, MOVE_TIMING.placeMin, MOVE_TIMING.placeMax), reduced || !fieldPlacement);
  }
}

type Candidate = {
  event: DuelEvent;
  style: MoveStyle;
  base: number;
  lead: number;
  hold: number;
  silent: boolean;
  destroy: boolean;
  /** A wipe piece drew the card on the canvas: it reaches its pile at `notBefore` with a short fade. */
  takeover: boolean;
  pieces: "burst" | "scattered" | null;
  /** A battle holds this destroy: the flight starts no earlier than this (performance.now(), 0 = free). */
  notBefore: number;
  paired: number[];
  source: ZoneSnapshot | null;
  /** Index in `fresh`: a run of moves is a set of candidates with no other kind of event between them. */
  index: number;
  /** The showcase starts here (style "add"). */
  origin: ShowcaseOrigin | null;
  predecessor?: Candidate;
  /** A Tribute of a Tribute Summon: it plays at a fixed time with its siblings, not in the serial queue. */
  tribute?: { index: number; count: number; to: DuelZoneRef };
  /** The monster summoned with Tributes: it waits for their energy (the number of Tributes). */
  tributeWait?: number;
};

/** Departing cards use frozen geometry; a stationary Deck uses its currently displayed anchor. */
export function resolveSource(zone: DuelZoneRef, eventId?: number): ZoneSnapshot | null {
  // Seat assignments and viewer perspective can change before the opening snapshot commits.
  // The Deck remains on the board: an old seat-indexed rect can point at the other player's Deck.
  if (zone.location !== LOCATION_DECK) {
    if (eventId != null && departureSnapshots.has(eventId)) return departureSnapshots.get(eventId) ?? null;
    const snap = getZoneSnapshot(zone);
    if (snap) return snap;
  }
  const live = findMoveZoneElement(zone);
  if (!live) return null;
  const r = moveDestinationRect(live);
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
  const to = findMoveDestination(event);
  const toRect = to ? moveDestinationRect(to) : event.zone?.location === LOCATION_HAND ? handArrivalTarget(event)?.rect : undefined;
  if (!toRect || toRect.width < 4) return null;
  const fromRect = event.from ? resolveSource(event.from, event.id)?.rect : null;
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
  const roles = tributeRoles(fresh);
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
    let silent = false;
    let destroy = false;
    let takeover = false;
    let pieces: "burst" | "scattered" | null = null;
    let notBefore = 0;

    // The summon, set or activation this card lands for.
    for (let j = i + 1; j < fresh.length && j <= i + 8; j += 1) {
      const next = fresh[j];
      if (claimed.has(next.id) || pairs.has(next.id)) continue;
      if ((next.kind === "summon" || next.kind === "set" || next.kind === "activate") && sameZone(next.zone, to)) {
        paired.push(next.id);
        claimed.add(next.id);
        // A big summon is drawn by its own effect: the card does not fly in first.
        if (playsBigSummon(next, from.location, reduced)) silent = true;
        break;
      }
    }
    // The destruction this card flies off from: it cracks in place, then goes to the pile.
    for (const other of fresh) {
      if (other.kind !== "destroy" || claimed.has(other.id) || pairs.has(other.id)) continue;
      if (!sameZone(other.zone, from) || other.card == null || other.card.code <= 0) continue;
      paired.push(other.id);
      claimed.add(other.id);
      destroy = true;
      lead = reduced ? 0 : other.cause === "battle" ? MOVE_TIMING.destroyBreakBattleMs : MOVE_TIMING.destroyBreakMs;
      // A fight that killed the card is still playing: it breaks only after the last strike landed.
      notBefore = battleDestroyAt(other.zone, now);
      if (notBefore > 0) lead = reduced ? 0 : HELD_CRACK_MS;
      // The 3D layer breaks the card into shards: the pile receives it after they fell, no flight.
      if (notBefore > 0 && battleBreakIs3d(other.zone, now)) {
        notBefore += BREAK_SETTLE_MS;
        lead = 0;
        style = "fade";
      } else if (notBefore > 0 && !reduced) {
        pieces = "scattered";
        // The DOM slice draws the halves at the break: the card leaves for the pile only after they were
        // seen. The crack and the break of the card itself keep their time (the lead grows by the same wait).
        notBefore += BREAK_SETTLE_MS;
        lead += BREAK_SETTLE_MS;
      } else if (!reduced) {
        pieces = "burst";
      }
      if (style !== "toss") pieces = null;
      break;
    }
    // A wipe piece (Dark Hole, Raigeki, a banish of the whole field...) drew this card on the canvas and flew
    // it to its pile there: the page pile only takes it when that streak arrives. No flight, and no gap in
    // the queue: all cards of the wipe arrive on the times of the piece.
    const wipe = reduced ? null : battleTakeover(from, now);
    if (wipe) {
      takeover = true;
      destroy = false;
      notBefore = wipe.moveAt;
      lead = 0;
      hold = 0;
      silent = false;
      pieces = null;
      style = "fade";
    }
    // A Tribute of a Tribute Summon burns into energy; the summoned monster waits for it. Under reduced motion
    // the Tribute fades (style "fade") and the summon waits a short beat.
    const role = roles.get(event.id);
    let tribute: Candidate["tribute"];
    let tributeWait: number | undefined;
    if (role && !takeover && !destroy) {
      if (role.role === "tribute") {
        if (!reduced && style === "toss") {
          style = "tribute";
          tribute = { index: role.index, count: role.count, to: role.to };
        } else if (reduced) {
          tribute = { index: 0, count: role.count, to: role.to };
        }
      } else {
        tributeWait = role.count;
      }
    }
    // The effect of a resolving chain link plays while its badge is lit, never before it. A card that
    // cracks first leaves for the pile only after the crack, so the lead counts from that moment.
    const chainAt = [event.id, ...paired].reduce((max, id) => Math.max(max, chainEffectAt(id)), 0);
    if (chainAt > now) notBefore = Math.max(notBefore, chainAt + lead);
    // A card that also breaks away from a destroyed zone keeps its flight.
    if (lead > 0) silent = false;
    // The room draws this arrival itself, but it keeps the V1 time slot (the flight's duration) in the queue.
    const roomDraws = !silent && lead === 0 && !destroy && !takeover && silentMoveRule?.(event) === true;
    if (roomDraws) silent = true;
    const source = resolveSource(from, event.id);
    const origin = style === "add" ? showcaseOrigin(event, now, source != null) : null;
    candidates.push({ event, style, base: silent && !roomDraws ? 0 : baseDuration(style, geo.distance, reduced, isFieldPlacementLocation(to.location)), lead, hold, silent, destroy, takeover, pieces, notBefore, paired, source, index: i, origin, tribute, tributeWait });
  }
  if (candidates.length === 0) {
    sequenceEffects(fresh, [...plans.values()], now, reduced);
    return [];
  }
  const chained = new Set<Candidate>();
  const byId = new Map(candidates.map((item) => [item.event.id, item]));
  const pending = new Map<number, Array<Candidate | undefined>>();
  // Follow engine slots through the complete batch, including moves without visible anchors.
  // Draws, searches and Exchange can all be followed by departures after other cards moved;
  // removing a hand card compacts the remaining sequences before the next move is observed.
  for (const event of fresh) {
    if (!isMoveEvent(event) || sameZone(event.from, event.zone)) continue;
    const from = event.from!;
    const to = event.zone!;
    const item = byId.get(event.id);
    if (from.location === LOCATION_HAND) {
      const hand = pending.get(from.controller) ?? [];
      let previous = hand[from.sequence];
      const afterCode = event.card?.code;
      if (afterCode != null && (previous == null || (previous.event.card?.code != null && previous.event.card.code !== afterCode))) {
        // SHUFFLE_HAND is not an animation event. Only an explicitly retired arrival may
        // follow its known code across that permutation; an older identical copy can also leave.
        previous = hand.find((arrival) => arrival?.event.handId?.startsWith("departed-") && arrival.event.card?.code === afterCode);
      }
      const beforeCode = previous?.event.card?.code;
      if (item && previous && (!previous.event.handId || previous.event.handId.startsWith("departed-")) &&
        !((afterCode == null || afterCode <= 0) && previous.event.handShuffled) &&
        (beforeCode == null || afterCode == null || beforeCode === afterCode)) {
        item.predecessor = previous;
        chained.add(previous);
        const target = handArrivalTarget(previous.event);
        if (target) item.source = { ...target, faceUp: (previous.event.card?.code ?? 0) > 0, defense: false };
      }
      if (previous) {
        const matched = hand.indexOf(previous);
        // The departure identifies its engine slot after an unreported shuffle. Preserve the
        // displaced pending entry until a later message identifies it, then compact once.
        if (matched !== from.sequence) hand[matched] = hand[from.sequence];
      }
      hand.splice(from.sequence, 1);
      pending.set(from.controller, hand);
    }
    if (to.location === LOCATION_HAND) {
      const hand = pending.get(to.controller) ?? [];
      // Empty entries represent older cards or moves without visible anchors.
      hand.length = Math.max(hand.length, to.sequence);
      hand.splice(to.sequence, 0, item);
      pending.set(to.controller, hand);
    }
  }
  // The showcase of a run goes first: the card the player cares about is shown, then the rest of the
  // effect (the other cards to the Graveyard) plays. A run is moves with no other event between them.
  const runs: Candidate[][] = [];
  for (const item of candidates) {
    const run = runs[runs.length - 1];
    const prev = run?.[run.length - 1];
    const joined = prev != null && fresh.slice(prev.index + 1, item.index).every(isMoveEvent);
    if (joined) run.push(item);
    else runs.push([item]);
  }
  const ordered = runs.flatMap((run) => [...run.filter((item) => item.style === "add"), ...run.filter((item) => item.style !== "add")]);
  candidates.splice(0, candidates.length, ...ordered);

  const t0 = Math.max(now, state.nextStartAt);
  const t0Free = now;
  // The Tributes of a Tribute Summon lift together (a short stagger) and the summoned monster starts as their last
  // energy lands, so it cannot start before then: its start is a floor, like a battle hold.
  for (const item of candidates) {
    if (item.tributeWait == null) continue;
    const energyEnd = reduced
      ? t0 + TRIBUTE_TIMING.reducedMs
      : t0 + (item.tributeWait - 1) * TRIBUTE_TIMING.staggerMs + TRIBUTE_FLIGHT_MS - TRIBUTE_TIMING.summonLeadMs;
    item.notBefore = Math.max(item.notBefore, energyEnd);
  }
  const deal = isDealBatch(candidates.map((item) => item.event)) && candidates.every((item) => !item.takeover && !item.silent);
  const place = (speed: number) => {
    let cursor = t0;
    const out: Array<{ start: number; dur: number; phases: ShowcasePhases | null }> = [];
    candidates.forEach((item, index) => {
      if (item.tribute) {
        // Fixed time beside its siblings: it neither waits for the cards before it nor delays the ones after it.
        out.push({ start: Math.max(t0 + item.tribute.index * (reduced ? 0 : TRIBUTE_TIMING.staggerMs), item.notBefore), dur: item.base, phases: null });
        return;
      }
      if (item.takeover) {
        // Fixed time, outside the serial queue: it neither waits for the cards before it nor delays the ones after it.
        out.push({ start: Math.max(item.notBefore, t0Free), dur: item.base, phases: null });
        return;
      }
      // A showcase has fixed legs (the hold stays long enough to read); the rest of the queue gives way.
      const phases = item.style === "add" ? showcasePhases(speed, reduced) : null;
      // A dealt card flies a little quicker than a lone draw; reduced motion keeps its short fade.
      const dur = phases ? phases.totalMs : deal && !reduced ? MOVE_TIMING.dealMs * speed : item.base * speed;
      const predecessorIndex = item.predecessor ? candidates.indexOf(item.predecessor) : -1;
      const predecessor = out[predecessorIndex];
      // A continuation starts exactly where its own card lands, even while other cards in the
      // effect are arriving. Keep the serial queue moving forward for unrelated flights.
      const start = Math.max(predecessor ? predecessor.start + predecessor.dur + item.lead : cursor + item.lead, item.notBefore);
      out.push({ start, dur, phases });
      // The next card of the effect starts as the showcase card sets off for the hand.
      const minGap = item.event.zone?.location === LOCATION_HAND ? MOVE_TIMING.handMinGapMs : MOVE_TIMING.minGapMs;
      const gate = phases ? showcaseGateMs(phases, candidates[index + 1]?.style === "add")
        : deal ? MOVE_TIMING.dealGapMs : Math.max(dur * MOVE_TIMING.overlap, minGap);
      cursor = Math.max(cursor, start + gate);
    });
    return { out, cursor };
  };
  let speed = 1;
  let layout = place(speed);
  // Time spent waiting for a battle is not a backlog to squeeze: measure from the latest hold.
  const queued = candidates.filter((item) => !item.takeover && !item.tribute);
  const queueCap = queued.every((item) => item.event.zone?.location === LOCATION_HAND) ? MOVE_TIMING.handQueueCapMs : MOVE_TIMING.queueCapMs;
  const floor = queued.reduce((max, item) => Math.max(max, item.notBefore), now);
  const finishQueued = (l: ReturnType<typeof place>) => l.out.reduce((max, o, i) => (candidates[i].takeover || candidates[i].tribute ? max : Math.max(max, o.start + o.dur)), 0);
  const span = finishQueued(layout) - floor;
  if (span > queueCap) {
    const fixed = queued.reduce((sum, item) => sum + item.lead, 0);
    const variable = span - fixed;
    speed = clamp((queueCap - fixed) / Math.max(1, variable), MOVE_TIMING.minSpeed, 1);
    layout = place(speed);
  }

  const created: MovePlan[] = [];
  candidates.forEach((item, index) => {
    const { start, dur, phases } = layout.out[index];
    const plan: MovePlan = {
      id: item.event.id,
      event: { ...item.event },
      style: item.style,
      startAt: start,
      landAt: start + dur,
      durationMs: dur,
      leadMs: item.lead,
      notBeforeAt: item.notBefore,
      // After a showcase lands, the ring of light plays on the hand card.
      holdMs: chained.has(item) ? 0 : phases ? phases.glowMs : item.hold,
      destroy: item.destroy,
      takeover: item.takeover,
      pieces: item.pieces,
      silent: item.silent,
      pairedIds: item.paired,
      reduced,
      source: item.source,
      showcase: phases && item.origin ? { origin: item.origin, phases } : null,
      handoff: candidates.find((candidate) => candidate.predecessor === item)?.event.id,
      handoffFrom: item.predecessor?.event,
      ...(item.tribute && item.style === "tribute" ? { tribute: item.tribute } : null),
    };
    plans.set(plan.id, plan);
    for (const id of item.paired) pairs.set(id, plan.id);
    created.push(plan);
  });
  state.nextStartAt = layout.cursor;
  sequenceEffects(fresh, [...plans.values()], now, reduced);
  // Keep the queue's existing overlap gate on its final, reconciled flight.
  state.nextStartAt += created[created.length - 1].startAt - layout.out[layout.out.length - 1].start;
  return created;
}

/* ---------- zone snapshots ----------
 * By the time a move event arrives the board already shows the new state: the card has left its
 * hand slot or zone. The pre-commit boundary freezes sources for fresh events before React changes
 * the DOM; background snapshots remain a fallback for effects without a departure event. */

export type ZoneSnapshot = {
  rect: { left: number; top: number; width: number; height: number };
  side: "you" | "opp";
  /** The anchor showed a card image (own hand, face-up card) rather than a sleeve. */
  faceUp: boolean;
  defense: boolean;
};

const snapshots = new Map<string, ZoneSnapshot>();
const snapshotCards = new Map<string, { code: number; owner: boolean }>();
const handRails = new Map<string, ZoneSnapshot>();
const departureSnapshots = new Map<number, ZoneSnapshot | null>();

/** A failed pre-commit capture must never fall through to a replacement hand slot. */
export function invalidateHandDepartures(events: readonly DuelEvent[]): void {
  for (const event of events) {
    if (isMoveEvent(event) && event.from?.location === LOCATION_HAND) departureSnapshots.set(event.id, null);
  }
}
const DEPARTURE_SNAPSHOT_CAP = 512;

/** A new board must not reuse another duel's coordinates or event IDs. */
export function clearZoneSnapshots(): void {
  snapshots.clear();
  snapshotCards.clear();
  handRails.clear();
  departureSnapshots.clear();
}

export function captureZoneSnapshots(root: ParentNode = document): void {
  snapshots.clear();
  snapshotCards.clear();
  handRails.clear();
  root.querySelectorAll<HTMLElement>("[data-zones]").forEach((el) => {
    const r = moveDestinationRect(el);
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
      snapshotCards.set(key, { code: artCodeOf(el), owner: el.closest<HTMLElement>("[data-hand-id]")?.dataset.handId?.startsWith("hand-") === true });
    }
  });
  root.querySelectorAll<HTMLElement>("[data-hand-seat]").forEach((el) => {
    const seat = Number(el.dataset.handSeat);
    const target = handArrivalTarget({ id: 0, kind: "move", text: "Hand anchor", handId: "snapshot-missing",
      zone: { controller: seat, location: LOCATION_HAND, sequence: 0 } });
    if (!target) return;
    handRails.set(el.dataset.handSeat ?? "", {
      ...target,
      faceUp: false,
      defense: false,
    });
  });
}

/** Called before a batch commits. Each engine removal compacts its hand, but keeps the original rect. */
export function captureDepartureSnapshots(events: readonly DuelEvent[], root: ParentNode = document): void {
  captureZoneSnapshots(root);
  type HandSource = { snapshot: ZoneSnapshot | null; code: number };
  const hands = new Map<number, Array<HandSource | null>>();
  const ownedHands = new Set<number>();
  for (const [key, snapshot] of snapshots) {
    const [seat, location, sequence] = key.split(":").map(Number);
    if (location !== LOCATION_HAND) continue;
    const hand = hands.get(seat) ?? [];
    const card = snapshotCards.get(key);
    hand[sequence] = { snapshot, code: card?.code ?? 0 };
    if (card?.owner) ownedHands.add(seat);
    hands.set(seat, hand);
  }
  for (const event of events) {
    if (!isMoveEvent(event)) continue;
    const from = event.from!;
    const to = event.zone!;
    const sourceHand = from.location === LOCATION_HAND ? hands.get(from.controller) : undefined;
    let sourceSequence = from.sequence;
    const indexed = sourceHand?.[sourceSequence];
    const code = event.card?.code ?? 0;
    if (sourceHand && ownedHands.has(from.controller) && code > 0 && indexed?.code !== code) {
      // SHUFFLE_HAND has no projected event. An owner can still identify its departed card in
      // the old DOM; consume that copy once. Opponent/spectator sleeves stay slot-bound, and a
      // missing known card never borrows the indexed replacement's geometry. Unknown sleeves
      // (including Exchange transfers) still occupy and consume their engine sequence.
      const matched = sourceHand.findIndex((entry) => entry?.code === code && (!entry.snapshot || entry.snapshot.side === "you"));
      sourceSequence = matched >= 0 ? matched : from.sequence;
    }
    const sourceEntry = sourceHand?.[sourceSequence] ?? null;
    const mismatchedOwner = sourceHand && ownedHands.has(from.controller) && code > 0 &&
      sourceEntry != null && sourceEntry.code > 0 && sourceEntry.code !== code;
    const source = from.location === LOCATION_HAND ? mismatchedOwner ? null : sourceEntry?.snapshot ?? null : getZoneSnapshot(from);
    departureSnapshots.set(event.id, source);
    if (from.location === LOCATION_HAND && sourceSequence >= 0) sourceHand?.splice(sourceSequence, 1);
    if (to.location === LOCATION_HAND) {
      const hand = hands.get(to.controller) ?? [];
      // A card added and removed within this batch has no old DOM anchor; its preceding flight
      // supplies the hand source. Keep its known code so a later shuffle can distinguish this
      // unanchored arrival from an older duplicate without borrowing replacement geometry.
      hand.splice(to.sequence, 0, from.location === LOCATION_HAND && sourceEntry ? { ...sourceEntry, code: code || sourceEntry.code } : { snapshot: null, code });
      hands.set(to.controller, hand);
    }
  }
  while (departureSnapshots.size > DEPARTURE_SNAPSHOT_CAP) departureSnapshots.delete(departureSnapshots.keys().next().value!);
}

export function getZoneSnapshot(zone: DuelZoneRef): ZoneSnapshot | null {
  const exact = snapshots.get(zoneKey(zone.controller, zone.location, zone.sequence));
  if (exact) return exact;
  if (zone.location === LOCATION_HAND) {
    return handRails.get(String(zone.controller)) ?? null;
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
