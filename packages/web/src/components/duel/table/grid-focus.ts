"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { ZOOM_MUL_MAX, ZOOM_MUL_MIN } from "./grid-layout";

/**
 * Where the 4-way grid looks. `seat` is the field in focus (big), or null for all four fields. `mul` is the player's
 * +/- zoom on top of the focus size. `last` is the field that comes back when the player zooms in from the overview.
 */
export interface GridFocus {
  seat: number | null;
  mul: number;
  last: number;
}

export type GridFocusAction =
  | { type: "focus"; seat: number }
  | { type: "all" }
  | { type: "zoomIn" }
  | { type: "zoomOut" };

const STEP = 1.18;
/** Zooming out below this size shows all four fields. */
const OVERVIEW_BELOW = 0.75;

export function initialGridFocus(seat: number): GridFocus {
  return { seat, mul: 1, last: seat };
}

export function gridFocusReducer(state: GridFocus, action: GridFocusAction): GridFocus {
  switch (action.type) {
    case "focus":
      return state.seat === action.seat && state.mul === 1 ? state : { seat: action.seat, mul: 1, last: action.seat };
    case "all":
      return state.seat == null ? state : { seat: null, mul: 1, last: state.seat };
    case "zoomIn":
      if (state.seat == null) return { seat: state.last, mul: 1, last: state.last };
      return state.mul >= ZOOM_MUL_MAX ? state : { ...state, mul: Math.min(ZOOM_MUL_MAX, state.mul * STEP) };
    case "zoomOut": {
      if (state.seat == null) return state;
      const mul = state.mul / STEP;
      return mul < OVERVIEW_BELOW ? { seat: null, mul: 1, last: state.seat } : { ...state, mul: Math.max(ZOOM_MUL_MIN, mul) };
    }
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
}

export interface UseGridFocus {
  focus: GridFocus;
  focusSeat: (seat: number) => void;
  showAll: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

function typing(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node || typeof node.tagName !== "string") return false;
  return node.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
}

/** The focus of the grid and its keys: 1 to 4 focus a field, O and Esc show all fields, + and - zoom. */
export function useGridFocus({ enabled, home, shown, suspended, digitsFree, escapeFree }: UseGridFocusOptions): UseGridFocus {
  const [focus, dispatch] = useReducer(gridFocusReducer, home, initialGridFocus);
  const live = useRef({ enabled, shown, suspended, digitsFree, escapeFree });
  live.current = { enabled, shown, suspended, digitsFree, escapeFree };

  // A field whose cell goes empty cannot stay in focus: back to your own field, or to all fields when that is gone too.
  const gone = focus.seat != null && !shown.includes(focus.seat);
  useEffect(() => {
    if (!gone) return;
    dispatch(shown.includes(home) ? { type: "focus", seat: home } : { type: "all" });
  }, [gone, home, shown]);

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
      if (event.key === "+" || event.key === "=") {
        dispatch({ type: "zoomIn" });
        return;
      }
      if (event.key === "-" || event.key === "_") {
        dispatch({ type: "zoomOut" });
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
  const zoomIn = useCallback(() => dispatch({ type: "zoomIn" }), []);
  const zoomOut = useCallback(() => dispatch({ type: "zoomOut" }), []);
  return useMemo(() => ({ focus, focusSeat, showAll, zoomIn, zoomOut }), [focus, focusSeat, showAll, zoomIn, zoomOut]);
}
