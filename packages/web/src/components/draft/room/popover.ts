"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePresence } from "@/lib/motion";
import { popExitMs } from "./motion";

/**
 * A popover that keeps its place for the exit. `open` drives it: the popover stays in the DOM, marked
 * `data-state="closed"`, `inert` and `aria-hidden`, until the exit has run. It places itself under (or over)
 * the anchor, grows from the anchor's corner, takes focus when it opens, and closes on an outside press.
 *
 * The anchor is held in a ref, so a popover that is closing still knows where it was.
 */
export function usePopover(open: boolean, anchor: HTMLElement | null, onClose: () => void, focus: (el: HTMLElement) => HTMLElement | null) {
  const { mounted, state } = usePresence(open, popExitMs());
  const pop = useRef<HTMLDivElement>(null);
  const held = useRef<HTMLElement | null>(null);
  if (anchor) held.current = anchor;
  const at = anchor ?? held.current;

  useLayoutEffect(() => {
    const el = pop.current;
    if (!open || !el || !at) return;
    const r = at.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const below = r.bottom + 8 + h < window.innerHeight;
    el.style.top = `${below ? r.bottom + 8 : r.top - 8 - h}px`;
    el.style.left = `${Math.max(10, Math.min(window.innerWidth - w - 10, r.right - w))}px`;
    // grow from the anchor's right edge: the top when the popover sits below it, the bottom when above
    const box = el.getBoundingClientRect();
    el.style.transformOrigin = `${Math.max(0, Math.min(box.width, r.right - box.left))}px ${below ? "0" : "100%"}`;
    focus(el)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted, at]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || at?.contains(t)) return;
      onClose();
    };
    window.addEventListener("pointerdown", down);
    return () => window.removeEventListener("pointerdown", down);
  }, [open, at, onClose]);

  const closed = state === "closed";
  const props = {
    ref: pop,
    "data-state": state,
    ...(closed ? { inert: true, "aria-hidden": true } : null),
  };
  return { mounted, props, anchor: at };
}
