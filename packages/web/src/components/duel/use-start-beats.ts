"use client";

/**
 * The phase beats in the room (see phase-beats.ts): which phase the bar shows while the turn-start
 * phases pass one by one, and whether the player is held until they are done. Also tells the card and
 * banner layers whether to replay the opening of the duel (the deal of both hands) instead of dropping
 * its events as history.
 */
import { duelFxClock } from "./fx-clock";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DuelClock, DuelEngineView, DuelEvent } from "@yugidraft/shared/duels";
import { collectFreshEvents, maxEventId } from "./event-queue";
import { isOpeningView, openingPresentationMs, planPhaseBeats, type PhaseBeatPlan } from "./phase-beats";
import { DESTROY_HIDE_CAP_MS } from "./destroy-hide";

export type StartBeats = {
  /** The turn-start phases are passing: nothing can be answered yet. */
  active: boolean;
  /** The phase the bar shows while `active`; null lights nothing (the deal). Undefined: show the engine's phase. */
  phase: string | null | undefined;
  /** Where the card and banner layers start replaying events (0: the opening deal), or null for none. */
  replayFrom: number | null;
  /** Opening events already presented or too late to present, including in layers mounted earlier. */
  skipThrough: number | null;
  /** The opening deal waits for the card layers to mount: the hands stay hidden until then. */
  waiting: boolean;
  /**
   * The opening deal is playing: the card layers stay mounted even while the connection recovers. A
   * window focus or a socket retry raises `recovering` for a moment; unmounting MoveFx then would
   * drop the cards that are still on their way into the hand all at once.
   */
  dealing: boolean;
};

type Shown = { active: boolean; phase: string | null };
const IDLE: Shown = { active: false, phase: null };

// Each series game has its own duel slug. Keep this outside the room/layers so a reconnect,
// FX recovery or route remount cannot present an unchanged revision-zero opening twice.
const presentedOpenings = new Set<string>();

/**
 * Whether the card and banner layers are mounted: the duel can show them, and the connection is not
 * recovering, except while the opening deal plays. The room and this hook use the same rule.
 */
export function fxLayersUp(ready: boolean, recovering: boolean, dealing: boolean): boolean {
  return ready && (!recovering || dealing);
}

/**
 * How long the layers stay up through a `recovering` blip after the opening is claimed. An opening
 * with automatic effects has no known length (Infinity) and a duel without a clock has no grace
 * limit: cap it, or the layers would ignore `recovering` for the whole duel.
 */
function dealHoldMs(events: readonly DuelEvent[], reduced: boolean): number {
  return Math.min(DESTROY_HIDE_CAP_MS, openingPresentationMs(events, reduced) + 100);
}

export function useStartBeats({
  engine,
  clock,
  duelKey,
  reducedMotion,
  ready,
  recovering = false,
}: {
  engine: DuelEngineView | null | undefined;
  clock?: DuelClock | null;
  duelKey: string;
  reducedMotion: boolean;
  /** The duel can show its cards: the engine view is loaded and no error or gate covers the board. */
  ready: boolean;
  /**
   * The connection is recovering. The room hides the card and banner layers meanwhile (their events
   * are history when they return), except while the opening deal plays.
   */
  recovering?: boolean;
}): StartBeats {
  const receivedClock = useRef({ clock, at: performance.now() });
  if (receivedClock.current.clock !== clock) receivedClock.current = { clock, at: performance.now() };
  const graceLeft = clock?.startedAt == null ? Infinity
    : clock.startedAt - clock.serverNow - (performance.now() - receivedClock.current.at);
  const opening = engine != null && isOpeningView(engine);
  // A duel that is still at its very start replays its opening; one the player joins halfway does not.
  // The deal that was claimed above keeps the layers up until its presentation is over.
  const dealEndsAtRef = useRef(0);
  const keyRef = useRef(duelKey);
  // keyRef still holds the old key for the render in which duelKey changes: the old deal does not count.
  const dealing = keyRef.current === duelKey && duelFxClock.now() < dealEndsAtRef.current;
  // The card and banner layers are mounted.
  const layersUp = fxLayersUp(ready, recovering, dealing);
  const replayFrom = opening && !presentedOpenings.has(duelKey)
    && duelFxClock.realMs(openingPresentationMs(engine.events, reducedMotion)) + 100 <= graceLeft ? 0 : null;

  const [shown, setShown] = useState<Shown>(IDLE);
  const [, setOpeningClaim] = useState<string | null>(null);
  const cursorRef = useRef<number | null>(null);
  const timersRef = useRef<Set<number>>(new Set());
  const releaseAtRef = useRef(0);
  const mountedRef = useRef(false);
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const events = engine?.events;

  const clearTimers = () => {
    for (const timer of timersRef.current) duelFxClock.clearTimeout(timer);
    timersRef.current.clear();
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimers();
      // A remount (React strict mode) starts from the first events again, so the opening is still played.
      cursorRef.current = null;
      releaseAtRef.current = 0;
    };
  }, []);

  useLayoutEffect(() => {
    if (keyRef.current !== duelKey) {
      keyRef.current = duelKey;
      cursorRef.current = null;
      releaseAtRef.current = 0;
      dealEndsAtRef.current = 0;
      clearTimers();
      setShown(IDLE);
    }
    if (!events) return;
    if (!layersUp) {
      // The layers are gone and will read the first events again when they return: so does this hook.
      cursorRef.current = null;
      releaseAtRef.current = 0;
      clearTimers();
      setShown(IDLE);
      return;
    }
    if (opening && !presentedOpenings.has(duelKey)) {
      // The opening may arrive after an empty engine snapshot, when the cursor is already set.
      presentedOpenings.add(duelKey);
      if (replayFrom === 0) dealEndsAtRef.current = duelFxClock.now() + dealHoldMs(events, reducedRef.current);
      // Publish the consumed cursor to the layers even if this batch has no phase beats to show.
      setOpeningClaim(duelKey);
      if (replayFrom == null) {
        cursorRef.current = maxEventId(events) ?? 0;
        return;
      }
    }
    if (cursorRef.current == null) {
      cursorRef.current = replayFrom ?? maxEventId(events) ?? 0;
      if (replayFrom == null) return;
    }
    const cursor = cursorRef.current;
    const { nextCursor, fresh } = collectFreshEvents(events, cursor);
    if (fresh.length === 0) return;
    cursorRef.current = nextCursor;

    const now = duelFxClock.now();
    const plan: PhaseBeatPlan | null = planPhaseBeats(events, cursor, { now, reduced: reducedRef.current, duelKey });
    if (!plan) return;

    const after = (at: number, fn: () => void) => {
      const wait = at - now;
      if (wait <= 8) {
        fn();
        return;
      }
      const timer = duelFxClock.setTimeout(() => {
        timersRef.current.delete(timer);
        if (mountedRef.current) fn();
      }, wait);
      timersRef.current.add(timer);
    };
    // Held from now: the bar keeps what it showed (or nothing, at the very start) until the first beat.
    setShown((current) => (current.active ? current : { active: true, phase: plan.holdPhase }));
    for (const beat of plan.beats) after(beat.startAt, () => setShown({ active: true, phase: beat.phase }));
    releaseAtRef.current = Math.max(releaseAtRef.current, plan.releaseAt);
    after(plan.releaseAt, () => {
      // A later batch may have held the player for longer.
      if (duelFxClock.now() + 8 >= releaseAtRef.current) setShown(IDLE);
    });
  }, [duelKey, events, opening, replayFrom, layersUp]);

  const waiting = replayFrom === 0 && !layersUp;
  return {
    active: shown.active,
    phase: shown.active ? shown.phase : waiting ? null : undefined,
    replayFrom,
    skipThrough: opening && replayFrom == null ? maxEventId(events ?? []) : null,
    waiting,
    dealing,
  };
}
