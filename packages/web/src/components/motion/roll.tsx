"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { DURATION, EASE_OUT, prefersReducedMotion } from "@/lib/motion";

const TRAVEL = 55; // percent of the line

/**
 * A value that rolls when it changes: the old text moves up 55% and out while the new text comes in
 * from 55% below, over 220ms. Old and new share one grid cell, so the box never changes size mid-roll
 * and a slot clip keeps the travel inside the line. The first render, a value that did not change and
 * reduced motion all show the text with no animation. Put the accessible name on the parent: the
 * outgoing copy is aria-hidden.
 */
export function Roll({ value, className }: { value: string | number; className?: string }) {
  const text = String(value);
  const shown = useRef(text);
  const [leaving, setLeaving] = useState<string | null>(null);
  const incoming = useRef<HTMLSpanElement>(null);
  const outgoing = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const previous = shown.current;
    if (previous === text) return;
    shown.current = text;
    if (prefersReducedMotion()) return;
    const inEl = incoming.current;
    if (!inEl || typeof inEl.animate !== "function") return;
    setLeaving(previous);
    inEl.animate(
      [{ transform: `translateY(${TRAVEL}%)`, opacity: 0 }, { transform: "none", opacity: 1 }],
      { duration: DURATION.roll, easing: EASE_OUT },
    );
  }, [text]);

  // The outgoing copy exists only for the roll: it plays its exit when it mounts, then goes.
  useLayoutEffect(() => {
    if (leaving === null) return;
    const outEl = outgoing.current;
    const timer = setTimeout(() => setLeaving(null), DURATION.roll);
    if (outEl && typeof outEl.animate === "function") {
      outEl.animate(
        [{ transform: "none", opacity: 1 }, { transform: `translateY(-${TRAVEL}%)`, opacity: 0 }],
        { duration: DURATION.roll, easing: EASE_OUT, fill: "forwards" },
      );
    }
    return () => clearTimeout(timer);
  }, [leaving]);

  return (
    <span className={className ? `mo-roll ${className}` : "mo-roll"} data-rolling={leaving !== null ? "" : undefined}>
      {leaving !== null && <span ref={outgoing} className="mo-roll-v" aria-hidden="true">{leaving}</span>}
      <span ref={incoming} className="mo-roll-v">{text}</span>
    </span>
  );
}
