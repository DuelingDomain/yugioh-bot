"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { DuelEvent, DuelSeatView } from "@yugidraft/shared/duels";
import { LOCATION_DMZONE, LOCATION_MZONE } from "../constants";
import { collectFreshEvents, findZoneElement, maxEventId } from "../event-queue";
import { duelFxClock } from "../fx-clock";
import { getMovePlan, planMoves, setSilentMoveRule } from "../move-plan";
import { deckMasterSummonReady, playDeckMasterSummon, prewarmDeckMasterArt } from "./dm-summon-bridge";

/**
 * A Deck Master leaving its zone for a monster zone: a move from the Deck Master Zone (the engine reports that
 * source as 0x4000, or as 0 because the byte-sized location drops it) to a monster zone, of the seat's own master.
 */
export function isDeckMasterSummonMove(event: DuelEvent, seats: readonly DuelSeatView[]): boolean {
  if (event.kind !== "move" || !event.from || !event.zone) return false;
  if (event.from.location !== LOCATION_DMZONE && event.from.location !== 0) return false;
  if (event.zone.location !== LOCATION_MZONE) return false;
  const master = seats.find((seat) => seat.seat === event.zone!.controller)?.deckMaster;
  if (!master) return false;
  const code = event.card?.code ?? 0;
  return code <= 0 || code === master.card.code;
}

/** The part of the zone that shows the card (same pick as MoveFx hides): the card body, else the art. */
function cardBodyIn(zone: HTMLElement): HTMLElement | null {
  const art = zone.querySelector<HTMLElement>("[data-card-art]");
  if (!art) return null;
  const body = art.parentElement?.parentElement;
  return body && body !== zone && zone.contains(body) ? body : art;
}

/**
 * 3D mode only. Draws the Deck Master summon on the shared fx3d canvas (the hologram) in place of the V1 flight
 * from the dock. While mounted it tells the move planner that these moves are drawn by the room (so MoveFx draws no
 * ghost and does not hide the card; the plan keeps its V1 time slot), and it plays the effect at the plan's start.
 * It renders nothing. It is only imported by the solid chunk, so classic never loads or calls it.
 *
 * The rule asks `deckMasterSummonReady()` at planning time, which is the same test `playDeckMasterSummon` makes when it
 * starts; without a canvas the V1 flight stays.
 */
export function SolidDmSummonFx({ events, seats, duelKey, reducedMotion, planeRef }: {
  events: readonly DuelEvent[];
  seats: readonly DuelSeatView[];
  duelKey: string;
  reducedMotion: boolean;
  planeRef: RefObject<Element | null>;
}) {
  const seatsRef = useRef(seats);
  seatsRef.current = seats;
  const cursorRef = useRef<number | null>(null);
  const keyRef = useRef(duelKey);
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const cleanups = useRef(new Set<() => void>());

  useEffect(() => {
    setSilentMoveRule((event) => deckMasterSummonReady() && isDeckMasterSummonMove(event, seatsRef.current));
    const pending = cleanups.current;
    return () => {
      setSilentMoveRule(null);
      for (const cleanup of [...pending]) cleanup();
      pending.clear();
    };
  }, []);

  // Start loading the art early.
  const codes = seats.map((seat) => seat.deckMaster?.card.code ?? 0).join(",");
  useEffect(() => {
    for (const code of codes.split(",")) if (Number(code) > 0) prewarmDeckMasterArt(Number(code));
  }, [codes, events]);

  useLayoutEffect(() => {
    if (keyRef.current !== duelKey) {
      keyRef.current = duelKey;
      cursorRef.current = null;
    }
    if (cursorRef.current == null) {
      cursorRef.current = maxEventId(events) ?? 0;
      return;
    }
    const { nextCursor, fresh } = collectFreshEvents(events, cursorRef.current);
    cursorRef.current = nextCursor;
    if (fresh.length === 0 || (typeof document !== "undefined" && document.hidden)) return;
    const moves = fresh.filter((event) => isDeckMasterSummonMove(event, seatsRef.current));
    if (moves.length === 0) return;
    const now = duelFxClock.now();
    // Idempotent: MoveFx and SummonFx plan the same batch; whoever runs first fixes the timing.
    planMoves(fresh, { now, reduced: reducedRef.current, duelKey });
    for (const event of moves) {
      const plan = getMovePlan(event.id);
      // Not planned silent: the V1 flight draws this one.
      if (!plan || !plan.silent) continue;
      const zone = findZoneElement(event.zone);
      const seat = event.zone!.controller;
      const code = event.card?.code && event.card.code > 0 ? event.card.code : seatsRef.current.find((s) => s.seat === seat)?.deckMaster?.card.code ?? 0;
      if (!zone || code <= 0) continue;
      const card = cardBodyIn(zone);
      const abort = new AbortController();
      let timer = 0;
      let waiting = false;
      const release = () => {
        if (waiting && card) card.style.removeProperty("visibility");
        waiting = false;
      };
      const cleanup = () => {
        duelFxClock.clearTimeout(timer);
        abort.abort();
        release();
        cleanups.current.delete(cleanup);
      };
      cleanups.current.add(cleanup);
      const run = () => {
        // The bridge hides the card itself (opacity) from here on.
        release();
        const reduced = reducedRef.current;
        const still = findZoneElement(event.zone) ?? zone;
        const fresher = cardBodyIn(still) ?? card;
        void playDeckMasterSummon({ code, seat, zone: still, card: fresher, plane: planeRef.current, reduced, signal: abort.signal })
          .catch(() => false)
          .finally(() => cleanups.current.delete(cleanup));
      };
      const delay = plan.startAt - now;
      if (delay > 16) {
        // The card is on the board already; it waits invisible until the effect starts.
        if (card) { card.style.visibility = "hidden"; waiting = true; }
        timer = duelFxClock.setTimeout(run, delay);
      } else run();
    }
  }, [duelKey, events, planeRef]);

  return null;
}
