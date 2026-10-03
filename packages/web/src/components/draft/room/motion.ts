"use client";

/**
 * The room's animation setting: Full (everything), Calm (cards move, nothing loops), Off (nothing moves).
 * Saved on this device. Until someone chooses, the device's reduce-motion setting decides.
 * Everything animated goes through animate()/flight(), which do nothing when Off.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export type Motion = "full" | "calm" | "off";
export const MOTION_LEVELS: Motion[] = ["full", "calm", "off"];
export const MOTION_KEY = "yugidraft-room-motion";

export const MOTION_NOTES: Record<Motion, string> = {
  full: "Holograms, table lights and card movement.",
  calm: "Cards still move when you pick and pass. No looping effects.",
  off: "Nothing moves. Changes happen instantly.",
};

export function readStoredMotion(): Motion | null {
  try {
    const v = window.localStorage.getItem(MOTION_KEY);
    return v === "full" || v === "calm" || v === "off" ? v : null;
  } catch {
    return null;
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function initialMotion(): Motion {
  return readStoredMotion() ?? (prefersReducedMotion() ? "off" : "full");
}

let current: Motion = "full";
export function setCurrentMotion(level: Motion) {
  current = level;
}
export const motionOff = () => current === "off";
export const motionCalm = () => current !== "full";

export function useMotionSetting(): [Motion, (level: Motion) => void] {
  const [level, setLevel] = useState<Motion>(() => {
    const m = initialMotion();
    setCurrentMotion(m);
    return m;
  });
  useLayoutEffect(() => {
    setCurrentMotion(level);
  }, [level]);
  const choose = useCallback((next: Motion) => {
    setLevel(next);
    setCurrentMotion(next);
    try {
      window.localStorage.setItem(MOTION_KEY, next);
    } catch {
      /* private window: the choice lasts for this visit */
    }
  }, []);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      if (readStoredMotion()) return;
      setLevel(mq.matches ? "off" : "full");
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return [level, choose];
}

/* ---------- helpers ---------- */

export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** WAAPI wrapper. Resolves at once when animations are Off or the browser can't animate. */
export function animate(
  el: Element | null | undefined,
  frames: Keyframe[],
  opts: KeyframeAnimationOptions,
): Promise<void> {
  if (!el || typeof (el as HTMLElement).animate !== "function" || motionOff()) return Promise.resolve();
  try {
    const a = (el as HTMLElement).animate(frames, opts);
    return a.finished.then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FlightOptions {
  layer: HTMLElement | null;
  from: RectLike;
  to: RectLike;
  src?: string;
  /** "r g b" */
  glow?: string;
  arc?: number;
  duration?: number;
  swell?: number;
  keepRatio?: boolean;
  rotate?: number;
  className?: string;
  easing?: string;
  fade?: boolean;
}

/** A ghost card flies from one rect to another: measure, then animate a ghost on the fx layer. */
export function flight(o: FlightOptions): Promise<void> {
  const { layer, from, to } = o;
  if (!layer || motionOff() || typeof layer.animate !== "function") return Promise.resolve();
  const el = document.createElement("div");
  el.className = `kit-ghost ${o.className ?? ""}`;
  el.style.width = `${from.width}px`;
  el.style.height = `${from.height}px`;
  if (o.src) el.style.backgroundImage = `url("${o.src}")`;
  if (o.glow) el.style.setProperty("--glow", o.glow);
  layer.appendChild(el);
  const s = to.width / Math.max(1, from.width);
  const sy = o.keepRatio ? s : to.height / Math.max(1, from.height);
  const a = `translate(${from.left}px, ${from.top}px)`;
  const b = `translate(${to.left}px, ${to.top}px) scale(${s}, ${sy})`;
  const mx = (from.left + to.left) / 2;
  const my = Math.min(from.top, to.top) - (o.arc ?? 90);
  const ms = (1 + s) / 2 + (o.swell ?? 0.12);
  const rot = o.rotate ?? 0;
  return animate(
    el,
    [
      { transform: `${a} rotate(0deg)`, opacity: 1 },
      { transform: `translate(${mx}px, ${my}px) scale(${ms}) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.45 },
      { transform: `${b} rotate(${rot}deg)`, opacity: o.fade === false ? 1 : 0.85 },
    ],
    { duration: o.duration ?? 620, easing: o.easing ?? "cubic-bezier(0.45, 0, 0.2, 1)", fill: "forwards" },
  ).then(() => el.remove());
}
