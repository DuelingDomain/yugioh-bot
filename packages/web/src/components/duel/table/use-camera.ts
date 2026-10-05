"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { duelFxClock } from "../fx-clock";
import { isEliminated } from "../multi-seat";
import {
  cameraActionForKey,
  cameraReducer,
  isFaceOff,
  effectiveCamera,
  initialCamera,
  lockForEvents,
  lockForSeats,
  type CameraContext,
} from "./camera-model";
import { autoFollowSeat, targetChoices } from "./targets";
import type { CameraAction, CameraLockReason, CameraState, TableController, TableLayout, TargetChoice } from "./types";

export interface UseCameraOptions {
  controller: TableController;
  layout: TableLayout;
  /** The camera the table starts in (a preview link asks for one). */
  initial?: Partial<CameraState>;
  /** A lock that is on from the start and never ends by time. The preview shows the lock chip with it. */
  initialLock?: CameraLockReason | null;
  /** An attack is being aimed or its target chosen: the auto camera holds still. */
  aiming: boolean;
  /** A pick of a seat owns the number keys. */
  seatKeys: boolean;
  /** A menu or the pile viewer is open: no camera key fires while it is. */
  suspended?: boolean;
  /** Reads the real clock. A test injects its own. */
  now?: () => number;
}

export interface CameraCue {
  seat: number;
  reason: string;
}

export interface UseCamera {
  /** The stored camera: where the player left it. */
  state: CameraState;
  /** What the stage draws: the play view while an effect plays, the stored camera otherwise. */
  shown: CameraState;
  dispatch: (action: CameraAction) => void;
  locked: boolean;
  cue: CameraCue | null;
  choices: TargetChoice[];
  /** Seats the camera never goes to. */
  out: number[];
}

const maxEventId = (events: ReadonlyArray<{ id: number }>) => events.reduce((max, event) => Math.max(max, event.id), 0);

function typing(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node || typeof node.tagName !== "string") return false;
  return node.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
}

/**
 * The camera of a table: the pure model, the FX lock fed by engine events and seat changes, the auto camera, the
 * aim hold and the keys. It reads the clock only inside effects.
 */
export function useCamera({ controller, layout, initial, initialLock = null, aiming, seatKeys, suspended = false, now = Date.now }: UseCameraOptions): UseCamera {
  const { engine, prompt, viewerSeat, nameOf, reducedMotion } = controller;
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

  // FX lock: a new engine event, or a seat that starts to leave. With reduced motion the effects are instant, so no
  // lock starts (like the Rooftop), but the cursors still move: old events never lock the camera later.
  const lastId = useRef(maxEventId(engine.events));
  useEffect(() => {
    const lock = reducedMotion ? null : lockForEvents(engine.events, lastId.current, duelFxClock.factor());
    lastId.current = Math.max(lastId.current, lock?.lastId ?? 0, maxEventId(engine.events));
    if (lock) dispatch({ type: "lock", reason: lock.reason, nowMs: now(), ms: lock.ms });
  }, [engine.events, now, reducedMotion]);
  const lastSeats = useRef(engine.seats);
  useEffect(() => {
    const lock = reducedMotion ? null : lockForSeats(lastSeats.current, engine.seats, duelFxClock.factor());
    lastSeats.current = engine.seats;
    if (lock) dispatch({ type: "lock", reason: lock.reason, nowMs: now(), ms: lock.ms });
  }, [engine.seats, now, reducedMotion]);

  const lockUntil = state.lock?.untilMs ?? null;
  useEffect(() => {
    if (lockUntil == null || !Number.isFinite(lockUntil)) return;
    const timer = setTimeout(() => dispatch({ type: "tick", nowMs: now() }), Math.max(0, lockUntil - now()) + 16);
    return () => clearTimeout(timer);
  }, [lockUntil, now]);

  // The aim holds the auto camera.
  useEffect(() => {
    dispatch({ type: "aiming", on: aiming });
  }, [aiming]);

  // Auto camera follows a field with targets to pick; elimination alone never changes the view.
  const choices = useMemo(() => targetChoices(prompt, engine, viewerSeat, nameOf), [engine, nameOf, prompt, viewerSeat]);
  const follow = useMemo(() => autoFollowSeat(choices, engine, viewerSeat), [choices, engine, viewerSeat]);
  const followSeat = follow?.seat ?? null;
  useEffect(() => {
    dispatch({ type: "autoFollow", seat: followSeat });
  }, [followSeat, aiming]);

  // A rival that leaves the duel while it is the focus sends the camera home.
  useEffect(() => {
    const seat = state.mode === "focus" ? state.focusSeat : state.mode === "look" ? state.lookSeat : null;
    if (seat != null && out.includes(seat)) dispatch({ type: "home" });
  }, [out, state.focusSeat, state.lookSeat, state.mode]);

  // A 3-way face-off has one view. A move home is ignored under an FX lock, so this runs again when the lock ends.
  const faceOff = isFaceOff(layout, out);
  useEffect(() => {
    if (faceOff && state.mode !== "home") dispatch({ type: "home" });
  }, [faceOff, state.mode, state.lock]);

  const keyRef = useRef({ state, seatKeys, suspended });
  keyRef.current = { state, seatKeys, suspended };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target) || keyRef.current.suspended) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[role="dialog"][aria-modal="true"]') || document.querySelector('[aria-modal="true"]')) return;
      if (event.key === "Tab" && target?.closest?.("[data-slot='prompt'], [role='dialog']")) return;
      if (/^[1-9]$/.test(event.key) && keyRef.current.seatKeys) return;
      const action = cameraActionForKey(event, env.current.layout, keyRef.current.state, env.current.ctx);
      if (!action) return;
      if (event.key === "Tab" || event.key === " " || event.key === "s" || event.key === "S") event.preventDefault();
      dispatch(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = useMemo(() => effectiveCamera(state, 0), [state]);
  const cue = useMemo<CameraCue | null>(
    () => (state.autoMoved && state.mode === "focus" && state.focusSeat != null && follow?.seat === state.focusSeat ? { seat: state.focusSeat, reason: follow.reason } : null),
    [follow, state.autoMoved, state.focusSeat, state.mode],
  );
  const send = useCallback((action: CameraAction) => dispatch(action), []);

  return { state, shown, dispatch: send, locked: state.lock != null, cue, choices, out };
}
