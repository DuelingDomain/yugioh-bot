"use client";

import { TALK_LINES, type TalkLineId } from "@yugidraft/shared/ws/talk";
import { usePopover } from "./popover";

/** The fixed lines you can say to the table, as a popover under the Say button. */
export function SayMenu({
  open,
  anchor,
  waiting,
  onSay,
  onClose,
}: {
  /** False starts the exit; the menu leaves the DOM once it has played. */
  open: boolean;
  anchor: HTMLElement | null;
  /** True right after you spoke: the table only takes one line every few seconds. */
  waiting: boolean;
  onSay: (line: TalkLineId) => void;
  onClose: () => void;
}) {
  const { mounted, props, anchor: at } = usePopover(open, anchor, onClose, (el) => el.querySelector<HTMLElement>("button:not(:disabled)"));
  if (!mounted) return null;

  return (
    <div
      className="pop"
      id="sayPop"
      {...props}
      role="dialog"
      aria-label="Say something to the table"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
          at?.focus();
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
