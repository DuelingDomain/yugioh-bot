"use client";

import { useEffect, useRef } from "react";
import type { CameraAction } from "../table/types";
import { roofKeyAction } from "./roof-camera";

export interface UseRoofKeysOptions {
  /** Receives each camera action a key maps to (the roof reducer's dispatch). */
  dispatch: (action: CameraAction) => void;
  anchorSeat: number;
  pinned?: boolean;
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
export function useRoofKeys({ dispatch, anchorSeat, pinned = false, suspended = false, yields = false }: UseRoofKeysOptions): void {
  const ref = useRef({ dispatch, anchorSeat, pinned, suspended, yields });
  ref.current = { dispatch, anchorSeat, pinned, suspended, yields };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      const { dispatch: send, anchorSeat: anchor, pinned: pin, suspended: off, yields: yielded } = ref.current;
      if (off || yielded) return;
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
