"use client";

import { createContext, useCallback, useMemo, useRef, useState } from "react";
import type { DuelChainMode, DuelEngineView, DuelRoom, ReplayForkControl } from "@yugidraft/shared/duels";
import type { ForkSearchBinding, ForkViewControl } from "./api";

/** What this room is. A fork needs both the stored kind and the creator-only control; one alone fails closed. */
export type ForkRoomState =
  | { kind: "ordinary" }
  | { kind: "fork"; control: ReplayForkControl }
  | { kind: "unusable" };

export function forkRoomState(room: Pick<DuelRoom, "session" | "fork"> | null | undefined): ForkRoomState {
  if (!room) return { kind: "ordinary" };
  if (room.session.kind === "replay-fork") return room.fork ? { kind: "fork", control: room.fork } : { kind: "unusable" };
  // A control on an ordinary duel is no fork: the table never offers fork controls from it.
  return { kind: "ordinary" };
}

/**
 * True when the room shows what the view asked for. While it does not, answers and seat changes wait.
 * `fresh` adds the time check: a room that was received before the last change of the view is an old cache entry of a
 * key that was used earlier, so it is never settled, whatever seat it names. A room without a time counts as received.
 */
export function forkViewSettled(
  control: Pick<ReplayForkControl, "actingSeat" | "revealHands">,
  view: ForkViewControl | null,
  fresh?: { receivedAt?: number; changedAt: number },
): boolean {
  if (fresh && fresh.receivedAt != null && fresh.receivedAt < fresh.changedAt) return false;
  if (control.revealHands !== (view?.reveal ?? true)) return false;
  return view?.as == null || control.actingSeat === view.as;
}

/** Seats that can still act: in the engine view and not out. */
export function livingSeats(engine: Pick<DuelEngineView, "seats"> | null | undefined, manualSeats: readonly number[]): number[] {
  const out = new Set((engine?.seats ?? []).filter((seat) => seat.eliminated === true).map((seat) => seat.seat));
  return manualSeats.filter((seat) => !out.has(seat));
}

export type AskState = "all" | "mixed" | "unknown";

/** "all": every living seat asks at every response window. */
export function askAllState(chainModes: Readonly<Record<number, DuelChainMode>> | undefined, living: readonly number[]): AskState {
  if (!chainModes || living.length === 0) return "unknown";
  const modes = living.map((seat) => chainModes[seat]);
  if (modes.some((mode) => mode === undefined)) return "unknown";
  return modes.every((mode) => mode === "always") ? "all" : "mixed";
}

/**
 * The seat Follow prompt wants next: the seat the engine waits on, when it is not the one on screen. Null keeps the
 * seat. It never changes a seat by itself while the duel is over or the engine is still working.
 */
export function followSeat(engine: Pick<DuelEngineView, "prioritySeat" | "result"> | null | undefined, actingSeat: number): number | null {
  if (!engine || engine.result) return null;
  const waiting = engine.prioritySeat;
  return waiting != null && waiting !== actingSeat ? waiting : null;
}

export interface ForkViewState {
  follow: boolean;
  reveal: boolean;
  /** An explicit seat. Null follows the engine's priority seat. */
  seat: number | null;
  /** The view for the room key; null for the host defaults. */
  view: ForkViewControl | null;
  /** Turn Follow prompt on or off. Off keeps the seat on screen. */
  setFollow: (next: boolean, actingSeat: number) => void;
  setReveal: (next: boolean) => void;
  /** Show another seat. Follow prompt takes over again at the next prompt. */
  pickSeat: (seat: number | null) => void;
  /** `performance.now()` of the last change of the view; 0 before the first. Used with `forkViewSettled`. */
  changedAt: () => number;
}

/**
 * Follow prompt and Reveal hands are on by default. `onViewChange` runs, before the key changes, when the seat or the
 * reveal choice really changes: the room drops the cached views there, so a key used earlier never shows its old room.
 */
export function useForkViewState(onViewChange?: () => void): ForkViewState {
  const [follow, setFollowState] = useState(true);
  const [reveal, setRevealState] = useState(true);
  const [seat, setSeatState] = useState<number | null>(null);
  const view = useMemo<ForkViewControl | null>(() => (seat == null && reveal ? null : { as: seat, reveal }), [seat, reveal]);
  const latest = useRef({ seat, reveal });
  const changed = useRef(0);
  const notify = useRef(onViewChange);
  notify.current = onViewChange;
  const change = useCallback((next: { seat?: number | null; reveal?: boolean }) => {
    const seatNext = next.seat !== undefined ? next.seat : latest.current.seat;
    const revealNext = next.reveal !== undefined ? next.reveal : latest.current.reveal;
    if (seatNext === latest.current.seat && revealNext === latest.current.reveal) return;
    latest.current = { seat: seatNext, reveal: revealNext };
    changed.current = performance.now();
    notify.current?.();
    setSeatState(seatNext);
    setRevealState(revealNext);
  }, []);
  const setFollow = useCallback((next: boolean, actingSeat: number) => {
    setFollowState(next);
    change({ seat: next ? null : actingSeat });
  }, [change]);
  const setReveal = useCallback((next: boolean) => change({ reveal: next }), [change]);
  const pickSeat = useCallback((next: number | null) => change({ seat: next }), [change]);
  const changedAt = useCallback(() => changed.current, []);
  return { follow, reveal, seat, view, setFollow, setReveal, pickSeat, changedAt };
}

/** The announce-card search of a fork needs the acting seat, prompt and revision it searches for. Null on ordinary tables. */
export const ForkSearchContext = createContext<ForkSearchBinding | null>(null);
