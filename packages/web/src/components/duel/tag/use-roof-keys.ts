"use client";

import { useEffect, useRef } from "react";
import type { CameraAction } from "../table/types";
import { tagKeysPaused, type TagKeyState } from "./live-tag";
import { roofKeyAction } from "./roof-camera";

export interface UseRoofKeysOptions {
  /** Receives each camera action a key maps to (the roof reducer's dispatch). */
  dispatch: (action: CameraAction) => void;
  anchorSeat: number;
  pinned?: boolean;
  /**
   * What can hold the table keys. While `tagKeysPaused` says so, the camera takes no key: the digits belong to the seat
   * pick, the aim and the prompt, and a dialog or menu owns the keyboard. Same rule as TableShell's camera.
   */
  paused?: TagKeyState;
}

function typing(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node || typeof node.tagName !== "string") return false;
  return node.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
}

/**
 * Window key handling of the roof camera: digits 1-4 focus a seat, Tab steps the focus, and the letter keys of
 * `roofKeyAction`. Never takes keys typed in a field, keys with Ctrl/Meta/Alt, keys under a modal, or any key while
 * `paused` is open. Tab inside a prompt or dialog keeps its focus job.
 */
export function useRoofKeys({ dispatch, anchorSeat, pinned = false, paused }: UseRoofKeysOptions): void {
  const ref = useRef({ dispatch, anchorSeat, pinned, paused });
  ref.current = { dispatch, anchorSeat, pinned, paused };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      const { dispatch: send, anchorSeat: anchor, pinned: pin, paused: state } = ref.current;
      if (state && tagKeysPaused(state)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[role="dialog"][aria-modal="true"]') || document.querySelector('[aria-modal="true"]')) return;
      if (event.key === "Tab" && target?.closest?.("[data-slot='prompt'], [role='dialog']")) return;
      const action = roofKeyAction(event.key, { anchorSeat: anchor, pinned: pin }, { shift: event.shiftKey });
      if (!action) return;
      event.preventDefault();
      send(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
