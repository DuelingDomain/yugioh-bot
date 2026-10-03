"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { TALK_LINES, type TalkLineId } from "@yugidraft/shared/ws/talk";

/** The fixed lines you can say to the table, as a popover under the Say button. */
export function SayMenu({
  anchor,
  waiting,
  onSay,
  onClose,
}: {
  anchor: HTMLElement | null;
  /** True right after you spoke: the table only takes one line every few seconds. */
  waiting: boolean;
  onSay: (line: TalkLineId) => void;
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
    el.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
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
      id="sayPop"
      ref={pop}
      role="dialog"
      aria-label="Say something to the table"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
          anchor?.focus();
        }
      }}
    >
      <h3>Say something to the table</h3>
      <div className="says">
        {TALK_LINES.map((l) => (
          <button key={l.id} type="button" data-say={l.id} disabled={waiting} onClick={() => onSay(l.id)}>
            {l.text}
          </button>
        ))}
      </div>
      {waiting ? <p role="status">One line at a time. Try again in a moment.</p> : null}
    </div>
  );
}
