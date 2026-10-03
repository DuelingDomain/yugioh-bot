"use client";

/**
 * A full-viewport layer for the draft room and the finale. It renders into document.body after mount,
 * locks body scroll, and sets `inert` on every other child of the body so Tab cannot reach the shell behind it.
 * Both are counted, so two layers can overlap for a moment and the exact prior values are restored.
 */
import { forwardRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { duelFontClasses } from "@/components/duel/fonts";
import "./draft-room.css";

const inertCount = new WeakMap<Element, { n: number; had: boolean }>();
let scrollLocks = 0;
let savedOverflow = "";

export function lockOthers(except: Element): () => void {
  const others = Array.from(document.body.children).filter((el) => el !== except);
  others.forEach((el) => {
    const cur = inertCount.get(el);
    if (cur) cur.n += 1;
    else {
      inertCount.set(el, { n: 1, had: el.hasAttribute("inert") });
      el.setAttribute("inert", "");
    }
  });
  if (scrollLocks === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLocks += 1;
  return () => {
    others.forEach((el) => {
      const cur = inertCount.get(el);
      if (!cur) return;
      cur.n -= 1;
      if (cur.n <= 0) {
        inertCount.delete(el);
        if (!cur.had) el.removeAttribute("inert");
      }
    });
    scrollLocks -= 1;
    if (scrollLocks === 0) document.body.style.overflow = savedOverflow;
  };
}

type Attrs = Record<string, string | undefined>;

export const FullscreenLayer = forwardRef<
  HTMLDivElement,
  { children: React.ReactNode; attrs?: Attrs; label: string }
>(function FullscreenLayer({ children, attrs, label }, forwarded) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!root) return;
    return lockOthers(root);
  }, [root]);
  if (!mounted) return null;
  return createPortal(
    <div
      ref={(el) => {
        setRoot(el);
        if (typeof forwarded === "function") forwarded(el);
        else if (forwarded) forwarded.current = el;
      }}
      className={`dr ${duelFontClasses}`}
      role="dialog"
      aria-label={label}
      {...attrs}
    >
      {children}
    </div>,
    document.body,
  );
});
