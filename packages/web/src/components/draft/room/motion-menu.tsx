"use client";

import { MOTION_LEVELS, MOTION_NOTES, type Motion } from "./motion";
import { usePopover } from "./popover";

const LABEL: Record<Motion, string> = { full: "Full", calm: "Calm", off: "Off" };
export const motionLabel = (m: Motion) => LABEL[m];

/** The Full / Calm / Off setting, as a popover under the Animations button. */
export function MotionMenu({
  open,
  anchor,
  level,
  onChoose,
  onClose,
}: {
  /** False starts the exit; the menu leaves the DOM once it has played. */
  open: boolean;
  anchor: HTMLElement | null;
  level: Motion;
  onChoose: (m: Motion) => void;
  onClose: () => void;
}) {
  const { mounted, props, anchor: at } = usePopover(open, anchor, onClose, (el) => el.querySelector<HTMLElement>('button[aria-pressed="true"]') ?? el.querySelector<HTMLElement>("button"));
  if (!mounted) return null;

  return (
    <div
      className="pop"
      id="motionPop"
      {...props}
      role="dialog"
      aria-label="Animations"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
          at?.focus();
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
