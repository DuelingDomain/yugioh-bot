"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { MOTION_LEVELS, MOTION_NOTES, type Motion } from "./motion";

const LABEL: Record<Motion, string> = { full: "Full", calm: "Calm", off: "Off" };
export const motionLabel = (m: Motion) => LABEL[m];

/** The Full / Calm / Off setting, as a popover under the Animations button. */
export function MotionMenu({
  anchor,
  level,
  onChoose,
  onClose,
}: {
  anchor: HTMLElement | null;
  level: Motion;
  onChoose: (m: Motion) => void;
  onClose: () => void;
}) {
  const pop = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = pop.current;
    if (!el || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const below = r.bottom + 8 + h < window.innerHeight;
    el.style.top = `${below ? r.bottom + 8 : r.top - 8 - h}px`;
    el.style.left = `${Math.max(10, Math.min(window.innerWidth - w - 10, r.right - w))}px`;
    (el.querySelector<HTMLElement>('button[aria-pressed="true"]') ?? el.querySelector<HTMLElement>("button"))?.focus();
  }, [anchor]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    window.addEventListener("pointerdown", down);
    return () => window.removeEventListener("pointerdown", down);
  }, [anchor, onClose]);

  return (
    <div
      className="pop"
      id="motionPop"
      ref={pop}
      role="dialog"
      aria-label="Animations"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
          anchor?.focus();
        }
      }}
    >
      <h3>Animations</h3>
      <div className="seg" role="group" aria-label="Animations">
        {MOTION_LEVELS.map((m) => (
          <button key={m} type="button" aria-pressed={level === m} onClick={() => onChoose(m)}>
            {LABEL[m]}
          </button>
        ))}
      </div>
      <p>{MOTION_NOTES[level]}</p>
    </div>
  );
}
