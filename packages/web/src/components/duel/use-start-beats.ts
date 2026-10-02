"use client";

/**
 * The phase beats in the room (see phase-beats.ts): which phase the bar shows while the turn-start
 * phases pass one by one, and whether the player is held until they are done. Also tells the card and
 * banner layers whether to replay the opening of the duel (the deal of both hands) instead of dropping
 * its events as history.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DuelClock, DuelEngineView } from "@yugidraft/shared/duels";
import { collectFreshEvents, maxEventId } from "./event-queue";
import { isOpeningView, openingPresentationMs, planPhaseBeats, type PhaseBeatPlan } from "./phase-beats";

export type StartBeats = {
  /** The turn-start phases are passing: nothing can be answered yet. */
  active: boolean;
  /** The phase the bar shows while `active`; null lights nothing (the deal). Undefined: show the engine's phase. */
  phase: string | null | undefined;
  /** Where the card and banner layers start replaying events (0: the opening deal), or null for none. */
  replayFrom: number | null;
  /** The opening deal waits for the card layers to mount: the hands stay hidden until then. */
  waiting: boolean;
};

type Shown = { active: boolean; phase: string | null };
const IDLE: Shown = { active: false, phase: null };

// Each series game has its own duel slug. Keep this outside the room/layers so a reconnect,
// FX recovery or route remount cannot present an unchanged revision-zero opening twice.
const presentedOpenings = new Set<string>();

export function useStartBeats({
  engine,
  clock,
  duelKey,
  reducedMotion,
  ready,
}: {
  engine: DuelEngineView | null | undefined;
  clock?: DuelClock | null;
  duelKey: string;
  reducedMotion: boolean;
  /** The card and banner layers are mounted (the room hides them while it recovers a connection). */
  ready: boolean;
}): StartBeats {
  const receivedClock = useRef({ clock, at: performance.now() });
  if (receivedClock.current.clock !== clock) receivedClock.current = { clock, at: performance.now() };
  const graceLeft = clock?.startedAt == null ? Infinity
    : clock.startedAt - clock.serverNow - (performance.now() - receivedClock.current.at);
  const opening = engine != null && isOpeningView(engine);
  // A duel that is still at its very start replays its opening; one the player joins halfway does not.
  const replayFrom = opening && !presentedOpenings.has(duelKey)
    && openingPresentationMs(engine.events, reducedMotion) + 100 <= graceLeft ? 0 : null;

  const [shown, setShown] = useState<Shown>(IDLE);
  const cursorRef = useRef<number | null>(null);
  const keyRef = useRef(duelKey);
  const timersRef = useRef<Set<number>>(new Set());
  const releaseAtRef = useRef(0);
  const mountedRef = useRef(false);
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const events = engine?.events;

  const clearTimers = () => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
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
      clearTimers();
      setShown(IDLE);
    }
    if (!events) return;
    if (!ready) {
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

    const now = performance.now();
    const plan: PhaseBeatPlan | null = planPhaseBeats(events, cursor, { now, reduced: reducedRef.current, duelKey });
    if (!plan) return;

    const after = (at: number, fn: () => void) => {
      const wait = at - now;
      if (wait <= 8) {
        fn();
        return;
      }
      const timer = window.setTimeout(() => {
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
      if (performance.now() + 8 >= releaseAtRef.current) setShown(IDLE);
    });
  }, [duelKey, events, opening, replayFrom, ready]);

  const waiting = replayFrom === 0 && !ready;
  return {
    active: shown.active,
    phase: shown.active ? shown.phase : waiting ? null : undefined,
    replayFrom,
    waiting,
  };
}
