"use client";

import { useEffect, useRef } from "react";
import type { CameraAction, RoofCameraState } from "./roof-camera";
import { roofKeyAction } from "./roof-camera";

export interface UseRoofKeysOptions {
  /** Receives each camera action a key maps to (the roof reducer's dispatch). */
  dispatch: (action: CameraAction) => void;
  anchorSeat: number;
  /**
   * Input is suspended (a menu, the pile viewer, a dialog, the narrow sheet): `tagInputSuspended(...)` from live-tag.ts.
   * The same flag gates the aim flow. The camera takes no key.
   */
  suspended?: boolean;
  /**
   * The camera yields without suspending input (an aim, a seat pick, a centered prompt not yet revealed):
   * `tagCameraYields(...)`. The aim flow still needs its digits and Esc, so only the camera steps back.
   * Mirrors TableShell: `useCamera({ suspended, seatKeys, aiming })`.
   */
  yields?: boolean;
  /** The camera mode now: Esc goes back to the overview from any other mode. */
  mode?: RoofCameraState["mode"];
  /**
   * Esc is free for the camera: no prompt, aim or flyout owns it (`gridKeyGates(...).escapeFree`). Without it Esc
   * stays with them, so one press never both declines a prompt and moves the camera.
   */
  escapeFree?: boolean;
}

function typing(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node || typeof node.tagName !== "string") return false;
  return node.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName);
}

/**
 * Window key handling of the roof camera: digits 1-4 focus a seat, Tab steps the focus, and the letter keys of
 * `roofKeyAction`. Never takes keys typed in a field, keys with Ctrl/Meta/Alt, keys under a modal, or any key while
 * `suspended` or `yields` is true. Tab inside a prompt or dialog keeps its focus job.
 */
export function useRoofKeys({
  dispatch,
  anchorSeat,
  suspended = false,
  yields = false,
  mode,
  escapeFree = false,
}: UseRoofKeysOptions): void {
  const ref = useRef({ dispatch, anchorSeat, suspended, yields, mode, escapeFree });
  ref.current = { dispatch, anchorSeat, suspended, yields, mode, escapeFree };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A prompt (PromptCenter, capture phase) that took the key already called preventDefault: the camera stays out.
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      const { dispatch: send, anchorSeat: anchor, suspended: off, yields: yielded, mode: now, escapeFree: escFree } = ref.current;
      // Esc is the one key that works while the camera yields (a focus can be left at any time), but only when
      // nothing else owns it.
      if (off) return;
      if (yielded && !(event.key === "Escape" && escFree)) return;
      if (event.key === "Escape" && !escFree) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[role="dialog"][aria-modal="true"]') || document.querySelector('[aria-modal="true"]')) return;
      if (event.key === "Tab" && target?.closest?.("[data-slot='prompt'], [role='dialog']")) return;
      const action = roofKeyAction(event.key, { anchorSeat: anchor, mode: now }, { shift: event.shiftKey });
      if (!action) return;
      event.preventDefault();
      send(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
