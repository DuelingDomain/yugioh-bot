"use client";

import { useCallback, useEffect, useState } from "react";

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

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
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
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const stored = readStoredMotion();
    if (stored) setChosen(stored);
    setReduced(prefersReducedMotion());
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (!query?.addEventListener) return;
    const change = () => setReduced(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  const set = useCallback((level: Motion) => {
    setChosen(level);
    writeStoredMotion(level);
  }, []);

  return { motion: effectiveMotion(chosen, reduced), reduced, set };
}
