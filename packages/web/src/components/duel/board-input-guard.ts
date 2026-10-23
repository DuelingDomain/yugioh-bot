"use client";

import { useEffect, useRef } from "react";
import { boardMoving, boardMotionStamp, holdBoardMotion, onBoardMotionStart, watchBoardTransitions } from "./board-motion";

/**
 * What a click may do to the game: a card or a zone, the hand, a pile, the phase hub, the card menu and the attack confirm.
 * Hover, the inspector, the camera controls, the plates and the prompt panels are not here: they stay live while the board moves.
 */
export const ACTION_SURFACE = "[data-zones], [data-legal], [data-hand-seat], [data-pile], [data-hub-slot], [data-grid-hub], [data-hub], [role='menu'], [data-attack-confirm]";
/** What a press is on: the same card or zone at press and release, or it is no click. */
const PRESS_TARGET = `${ACTION_SURFACE}, button, a, [role='button'], [role='menuitem']`;
/** The click that follows a release arrives within the same input event; this long is plenty. */
const CLICK_WINDOW_MS = 120;

type Pressed = { key: string | Element | null; surface: boolean; stamp: number };

const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** A stable name for what a press is on (a card moves in the DOM while it stays the same card). */
function pressKey(target: EventTarget | null): Pick<Pressed, "key" | "surface"> {
  const node = (target as Element | null)?.closest?.(PRESS_TARGET) ?? null;
  if (!node) return { key: null, surface: false };
  const zones = node.closest<HTMLElement>("[data-zones]");
  const key = zones ? `zones:${zones.dataset.zones}` : node;
  return { key, surface: node.matches(ACTION_SURFACE) || node.closest(ACTION_SURFACE) != null };
}

/**
 * Installs the board input guard on the window and returns the cleanup. Two rules, both on the capture phase so the
 * game's own handlers never see the click (the aim flow also listens on the window, and the guard is there first):
 * 1. No click on the action surface while the board moves or settles (see board-motion.ts).
 * 2. A click is one press and one release on the same target, with no move of the board between them. A press that
 *    slides under the pointer and releases on another card is dropped.
 * Clicks with no pointer (Enter or Space on a focused card, `detail` 0) and hover are left alone.
 */
export function installBoardInputGuard(host: Window = window): () => void {
  let pressed: Pressed | null = null;
  let dropUntil = 0;
  const stopWatching = watchBoardTransitions(host);

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    pressed = { ...pressKey(event.target), stamp: boardMotionStamp() };
  };
  const onUp = (event: PointerEvent) => {
    const down = pressed;
    pressed = null;
    if (!down) return;
    const up = pressKey(event.target);
    const split = (down.surface || up.surface) && (down.key !== up.key || down.stamp !== boardMotionStamp());
    if (split) dropUntil = clock() + CLICK_WINDOW_MS;
  };
  const onCancel = () => {
    pressed = null;
  };
  const onClick = (event: MouseEvent) => {
    if (event.detail === 0) return;
    const target = event.target as Element | null;
    const onSurface = target?.closest?.(ACTION_SURFACE) != null;
    const dropped = clock() < dropUntil;
    dropUntil = 0;
    if (!dropped && !(onSurface && boardMoving())) return;
    event.stopImmediatePropagation();
    event.preventDefault();
  };

  host.addEventListener("pointerdown", onDown, true);
  host.addEventListener("pointerup", onUp, true);
  host.addEventListener("pointercancel", onCancel, true);
  host.addEventListener("click", onClick, true);
  host.addEventListener("dblclick", onClick, true);
  return () => {
    host.removeEventListener("pointerdown", onDown, true);
    host.removeEventListener("pointerup", onUp, true);
    host.removeEventListener("pointercancel", onCancel, true);
    host.removeEventListener("click", onClick, true);
    host.removeEventListener("dblclick", onClick, true);
    stopWatching();
  };
}

let installs = 0;
let uninstall: (() => void) | null = null;

/** The duel room mounts the guard once, however many shells ask for it. */
export function useBoardInputGuard(): void {
  useEffect(() => {
    if (installs === 0) uninstall = installBoardInputGuard();
    installs += 1;
    return () => {
      installs -= 1;
      if (installs === 0) {
        uninstall?.();
        uninstall = null;
      }
    };
  }, []);
}

/** Runs `onStart` each time the board goes from still to moving (the card menu closes: its anchor is about to slide). */
export function useOnBoardMotionStart(onStart: () => void): void {
  useEffect(() => onBoardMotionStart(onStart), [onStart]);
}

/**
 * The layout of the board changed with `key` (a seat left, the camera view changed): hold clicks for the settle time even when
 * nothing animates (reduced motion), so a click does not land on the old place of a card. The first render does not hold.
 */
export function useHoldOnLayoutChange(key: string): void {
  const last = useRef(key);
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    holdBoardMotion();
  }, [key]);
}
