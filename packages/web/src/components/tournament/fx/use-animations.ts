"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/motion";

export type Motion = "full" | "calm" | "off";

export const MOTION_KEY = "yd-anim";

const LEVELS: Motion[] = ["full", "calm", "off"];

export function isMotion(value: unknown): value is Motion {
  return typeof value === "string" && (LEVELS as string[]).includes(value);
}

/** Storage can be missing, blocked or full: every access is guarded. */
export function readStoredMotion(): Motion | null {
  try {
    const value = window.localStorage.getItem(MOTION_KEY);
    return isMotion(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredMotion(level: Motion) {
  try {
    window.localStorage.setItem(MOTION_KEY, level);
  } catch {
    // The choice still holds for this visit.
  }
}

/** Reduced motion turns Full into Calm. Off stays off. */
export function effectiveMotion(chosen: Motion, reduced: boolean): Motion {
  return reduced && chosen === "full" ? "calm" : chosen;
}

/**
 * The viewer's animation level: Full, Calm or Off, saved per viewer. It reads storage after the first
 * render (so server and client markup match), starts on Full, and reduced motion forces Calm.
 */
export function useAnimations() {
  const [chosen, setChosen] = useState<Motion>("full");
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const stored = readStoredMotion();
    if (stored) setChosen(stored);
  }, []);

  const set = useCallback((level: Motion) => {
    setChosen(level);
    writeStoredMotion(level);
  }, []);

  return { motion: effectiveMotion(chosen, reduced), reduced, set };
}
