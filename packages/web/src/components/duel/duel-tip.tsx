"use client";

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { duelFontClasses } from "./fonts";
import styles from "./duel-tip.module.css";

/**
 * A hint box for a control of the duel bars, in place of the browser's own `title` tooltip (which has no wrap, no edge
 * handling and no say over the layer it opens in). The box wraps at a fixed width, stays inside the window (it flips
 * under the control when there is no room above it, and slides back from a side edge), and lives in a portal at the
 * page root at --duel-z-tooltip, so no board layer can cover it.
 *
 * `const tip = useDuelTip();` then `<button {...tip.on("Hint text")}>` and render `{tip.node}` once.
 * The hint is also the control's accessible description, so a screen reader hears what a mouse user reads.
 */
export interface DuelTip {
  /** Event props for one control. Spread them; an empty text shows nothing. */
  on: (text: string) => {
    onPointerEnter: (event: PointerEvent<HTMLElement>) => void;
    onPointerLeave: () => void;
    onPointerDown: () => void;
    onFocus: (event: FocusEvent<HTMLElement>) => void;
    onBlur: () => void;
    "aria-description": string;
  };
  /** The open box (or null). Render it once, anywhere in the component. */
  node: ReactNode;
}

const MARGIN = 8;
const GAP = 8;

interface Open { text: string; rect: DOMRect }

export function useDuelTip(): DuelTip {
  const [open, setOpen] = useState<Open | null>(null);
  const show = useCallback((text: string, element: HTMLElement) => {
    if (!text) return;
    setOpen({ text, rect: element.getBoundingClientRect() });
  }, []);
  const hide = useCallback(() => setOpen(null), []);
  const on = useCallback((text: string) => ({
    // A finger has no hover: a tap would leave the box open until the next tap.
    onPointerEnter: (event: PointerEvent<HTMLElement>) => { if (event.pointerType !== "touch") show(text, event.currentTarget); },
    onPointerLeave: hide,
    // A press may change the control's label (End Turn, the primary button): the box closes rather than show the old text.
    onPointerDown: hide,
    onFocus: (event: FocusEvent<HTMLElement>) => { if (event.currentTarget.matches(":focus-visible")) show(text, event.currentTarget); },
    onBlur: hide,
    "aria-description": text,
  }), [show, hide]);
  const node = open && typeof document !== "undefined" ? createPortal(<TipBox open={open} onDismiss={hide} />, document.body) : null;
  return { on, node };
}

function TipBox({ open, onDismiss }: { open: Open; onDismiss: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties | null>(null);
  // Measured before paint: the box is drawn once, in its place.
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const above = open.rect.top - GAP - height >= MARGIN;
    const top = above ? open.rect.top - GAP - height : Math.min(open.rect.bottom + GAP, Math.max(MARGIN, viewH - MARGIN - height));
    const centre = open.rect.left + open.rect.width / 2;
    const left = Math.max(MARGIN, Math.min(centre - width / 2, viewW - MARGIN - width));
    setPlace({ left, top });
  }, [open]);
  // A scroll or a resize moves the control from under the box.
  useLayoutEffect(() => {
    window.addEventListener("resize", onDismiss);
    window.addEventListener("scroll", onDismiss, true);
    return () => {
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("scroll", onDismiss, true);
    };
  }, [onDismiss]);
  return (
    <div ref={box} className={`${duelFontClasses} ${styles.tip}`} role="tooltip" style={place ?? { left: 0, top: 0, visibility: "hidden" }}>
      {open.text}
    </div>
  );
}
