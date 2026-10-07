"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { isEliminated } from "../multi-seat";
import {
  cameraActionForKey,
  cameraReducer,
  isFaceOff,
  effectiveCamera,
  initialCamera,
  type CameraContext,
} from "./camera-model";
import { targetChoices, targetHintSeat } from "./targets";
import type { CameraAction, CameraLockReason, CameraState, TableController, TableLayout, TargetChoice } from "./types";

export interface UseCameraOptions {
  controller: TableController;
  layout: TableLayout;
  /** The camera the table starts in (a preview link asks for one). */
  initial?: Partial<CameraState>;
  /** A lock that is on from the start and never ends by time. The preview shows the lock chip with it. */
  initialLock?: CameraLockReason | null;
  /** A pick of a seat owns the number keys. */
  seatKeys: boolean;
  /** A menu or the pile viewer is open: no camera key fires while it is. */
  suspended?: boolean;
  /** The stage has no camera to move (the 4-way grid): only the upright key (S) fires, and Tab is left to the browser. */
  uprightOnly?: boolean;
  /** Reads the real clock. A test injects its own. */
  now?: () => number;
}

/** A field that holds the targets the viewer must pick. The table marks it; the camera stays where it is. */
export interface TargetHint {
  seat: number;
  reason: string;
}

export interface UseCamera {
  /** The stored camera: where the player left it. */
  state: CameraState;
  /** What the stage draws. */
  shown: CameraState;
  dispatch: (action: CameraAction) => void;
  locked: boolean;
  hint: TargetHint | null;
  choices: TargetChoice[];
  /** Seats the camera never goes to. */
  out: number[];
}

function typing(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node || typeof node.tagName !== "string") return false;
  return node.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
}

/**
 * The camera of a table: the pure model and the keys. The view changes ONLY on a click or a key of the viewer. A
 * remote move, a chain, an effect, a prompt or a new turn never moves it. When the viewer must pick a target on a
 * field that is not in view, `hint` names that field and the table marks it. It reads the clock only inside effects.
 */
export function useCamera({ controller, layout, initial, initialLock = null, seatKeys, suspended = false, uprightOnly = false, now = Date.now }: UseCameraOptions): UseCamera {
  const { engine, prompt, viewerSeat, nameOf } = controller;
  const out = useMemo(
    () => engine.seats.filter(isEliminated).map((view) => view.seat),
    [engine.seats],
  );
  const env = useRef<{ layout: TableLayout; ctx: CameraContext }>({ layout, ctx: { out } });
  env.current = { layout, ctx: { out } };

  const [state, dispatch] = useReducer(
    (current: CameraState, action: CameraAction) => cameraReducer(current, action, env.current.layout, env.current.ctx),
    undefined,
    () => initialCamera(layout, { ...initial, lock: initialLock ? { reason: initialLock, untilMs: Number.POSITIVE_INFINITY } : null }),
  );

  const lockUntil = state.lock?.untilMs ?? null;
  useEffect(() => {
    if (lockUntil == null || !Number.isFinite(lockUntil)) return;
    const timer = setTimeout(() => dispatch({ type: "tick", nowMs: now() }), Math.max(0, lockUntil - now()) + 16);
    return () => clearTimeout(timer);
  }, [lockUntil, now]);

  // A field with targets to pick is only marked, never followed.
  const choices = useMemo(() => targetChoices(prompt, engine, viewerSeat, nameOf), [engine, nameOf, prompt, viewerSeat]);
  const target = useMemo(() => targetHintSeat(choices, engine, viewerSeat), [choices, engine, viewerSeat]);

  // A rival that leaves the duel while it is the focus sends the camera home.
  useEffect(() => {
    const seat = state.mode === "focus" ? state.focusSeat : state.mode === "look" ? state.lookSeat : null;
    if (seat != null && out.includes(seat)) dispatch({ type: "home" });
  }, [out, state.focusSeat, state.lookSeat, state.mode]);

  // A 3-way face-off has one view: the camera goes home before the next paint, so the old pose never shows.
  const faceOff = isFaceOff(layout, out);
  useLayoutEffect(() => {
    if (faceOff && state.mode !== "home") dispatch({ type: "home" });
  }, [faceOff, state.mode]);

  const keyRef = useRef({ state, seatKeys, suspended, uprightOnly });
  keyRef.current = { state, seatKeys, suspended, uprightOnly };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target) || keyRef.current.suspended) return;
      if (keyRef.current.uprightOnly && event.key !== "s" && event.key !== "S") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[role="dialog"][aria-modal="true"]') || document.querySelector('[aria-modal="true"]')) return;
      if (event.key === "Tab" && target?.closest?.("[data-slot='prompt'], [role='dialog']")) return;
      // The rail and the drawer are ordinary controls: Tab walks through them, Space presses a button, and no key drives the camera from there.
      if (target?.closest?.("[data-table-chrome]")) return;
      if (/^[1-9]$/.test(event.key) && keyRef.current.seatKeys) return;
      // Esc belongs to what is open first (a card menu, a flyout, a pile, the chain details): only a bare table goes back.
      if (event.key === "Escape" && (event.defaultPrevented || document.querySelector("[role='dialog']:not([hidden]), [role='menu']:not([hidden])"))) return;
      const action = cameraActionForKey(event, env.current.layout, keyRef.current.state, env.current.ctx);
      if (!action) return;
      if (event.key === "Tab" || event.key === " " || event.key === "s" || event.key === "S") event.preventDefault();
      dispatch(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = useMemo(() => effectiveCamera(state, 0), [state]);
  const hint = useMemo<TargetHint | null>(
    () => (target && !(state.mode === "focus" && state.focusSeat === target.seat) ? target : null),
    [state.focusSeat, state.mode, target],
  );
  const send = useCallback((action: CameraAction) => dispatch(action), []);

  return { state, shown, dispatch: send, locked: state.lock != null, hint, choices, out };
}
