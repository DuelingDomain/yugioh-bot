"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { DuelPrompt } from "@yugidraft/shared/duels";
import { backOutAnswer } from "../pick-backout";

/** Where the 4-way grid looks. `seat` is the field in focus (large), or null for all four fields (an equal 2x2). */
export interface GridFocus {
  seat: number | null;
}

export type GridFocusAction = { type: "focus"; seat: number } | { type: "all" };

export function initialGridFocus(seat: number): GridFocus {
  return { seat };
}

export function gridFocusReducer(state: GridFocus, action: GridFocusAction): GridFocus {
  switch (action.type) {
    case "focus":
      return state.seat === action.seat ? state : { seat: action.seat };
    case "all":
      return state.seat == null ? state : { seat: null };
    default:
      return state;
  }
}

/** The digit keys 1 to 4 name the seats, as the numbers in the turn strip do. */
export function seatOfDigit(key: string, seats: readonly number[]): number | null {
  if (!/^[1-4]$/.test(key)) return null;
  const seat = Number(key) - 1;
  return seats.includes(seat) ? seat : null;
}

export interface GridKeyState {
  /** The prompt that is open, and the viewer's seat (null for a spectator). */
  prompt: DuelPrompt | null;
  viewerSeat: number | null;
  /** An attack is aimed or locked. */
  aiming: boolean;
  /** A seat pick owns the digit keys. */
  seatKeys: boolean;
  /** A flyout of the HUD is open (it closes on Esc by itself). */
  flyoutOpen: boolean;
}

/**
 * Which keys the focus may take. Esc belongs to an open prompt of the viewer first (Cancel, Finish, or the one step
 * back of a toggle pick), then to the aim and to an open flyout: it is one action, never two. The digit keys belong to
 * a seat pick and to an attack aim, which use them to pick or lock a target.
 */
export function gridKeyGates({ prompt, viewerSeat, aiming, seatKeys, flyoutOpen }: GridKeyState): { digitsFree: boolean; escapeFree: boolean } {
  const owned = prompt != null && prompt.seat === viewerSeat && (prompt.cancelable === true || prompt.finishable === true || backOutAnswer(prompt) != null);
  return { digitsFree: !seatKeys && !aiming, escapeFree: !aiming && !flyoutOpen && !owned };
}

export interface UseGridFocusOptions {
  enabled: boolean;
  /** The viewer's own seat (a spectator: seat 0). */
  home: number;
  /** Seats that have a field to show (not empty cells). */
  shown: readonly number[];
  /** A menu or the pile viewer is open: no key fires. */
  suspended: boolean;
  /** A seat pick owns the digit keys. */
  digitsFree: boolean;
  /** Escape belongs to an open prompt or to the aim. */
  escapeFree: boolean;
  /**
   * Seats that are gone from `shown` but still play their exit (the crumble). A focus on one of them stays until it is
   * not held any more, so the exit is seen at its full size before the focus goes home.
   */
  holding?: readonly number[];
}

export interface UseGridFocus {
  focus: GridFocus;
  focusSeat: (seat: number) => void;
  showAll: () => void;
  /**
   * The stage tells which seats still play their exit. Call it from a layout effect: a child's layout effect runs before
   * this hook's, so a seat that goes out and starts its exit in one commit is already held when the focus is checked.
   */
  hold: (seats: readonly number[]) => void;
}

function typing(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node || typeof node.tagName !== "string") return false;
  return node.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
}

/** The focus of the grid and its keys: 1 to 4 focus a field, O and Esc show all fields. */
export function useGridFocus({ enabled, home, shown, suspended, digitsFree, escapeFree, holding }: UseGridFocusOptions): UseGridFocus {
  const [focus, dispatch] = useReducer(gridFocusReducer, home, initialGridFocus);
  const live = useRef({ enabled, shown, suspended, digitsFree, escapeFree });
  live.current = { enabled, shown, suspended, digitsFree, escapeFree };

  // A field whose cell goes empty cannot stay in focus: back to your own field, or to all fields when that is gone too.
  const held = useRef<readonly number[]>([]);
  const [recheck, setRecheck] = useState(0);
  const gone = focus.seat != null && !shown.includes(focus.seat) && !holding?.includes(focus.seat);
  // A layout effect: the focus moves in the same frame the seat goes, so no frame shows a field that is not there.
  useLayoutEffect(() => {
    if (!gone || (focus.seat != null && held.current.includes(focus.seat))) return;
    dispatch(shown.includes(home) ? { type: "focus", seat: home } : { type: "all" });
  }, [gone, focus.seat, home, shown, recheck]);
  const hold = useCallback((seats: readonly number[]) => {
    const same = seats.length === held.current.length && seats.every((seat, index) => seat === held.current[index]);
    held.current = seats;
    // Only a hold that ends needs the check again: a new hold is already read by the effect of the same commit.
    if (!same) setRecheck((value) => value + 1);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const now = live.current;
      if (!now.enabled || now.suspended || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[role="dialog"][aria-modal="true"]') || document.querySelector('[aria-modal="true"]')) return;
      if (event.key === "Escape") {
        if (now.escapeFree) dispatch({ type: "all" });
        return;
      }
      if (event.key === "o" || event.key === "O") {
        dispatch({ type: "all" });
        return;
      }
      if (now.digitsFree) {
        const seat = seatOfDigit(event.key, now.shown);
        if (seat != null) dispatch({ type: "focus", seat });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const focusSeat = useCallback((seat: number) => dispatch({ type: "focus", seat }), []);
  const showAll = useCallback(() => dispatch({ type: "all" }), []);
  return useMemo(() => ({ focus, focusSeat, showAll, hold }), [focus, focusSeat, showAll, hold]);
}
