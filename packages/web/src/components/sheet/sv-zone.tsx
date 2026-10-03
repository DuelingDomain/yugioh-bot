import type { CSSProperties, ReactNode } from "react";
import { sv } from "./sv-util";

export type ZoneState = "won" | "lost" | "empty" | "dashed" | "now" | "pending";
export type TipAlign = "start" | "center" | "end";

/**
 * CSS-only tooltip. Wraps one control and shows `label` on hover (devices that hover) and on
 * keyboard focus inside. The tip is visual only (`aria-hidden`): give the wrapped control its own
 * accessible name. It is `position: absolute` and `display: none` until shown, so it never adds
 * scroll width.
 */
export function Tip({ label, children, side = "top", align = "center", className }: {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom" | "right";
  align?: TipAlign;
  className?: string;
}) {
  return (
    <span className={sv("sv-tipped", className)} data-side={side} data-align={align}>
      {children}
      <span className="sv-tip" aria-hidden="true">{label}</span>
    </span>
  );
}

function Star() {
  return (
    <svg className="sv-zone-star" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 1.5l2.9 7.2 7.6.6-5.8 5 1.8 7.5L12 17.7 5.5 21.8l1.8-7.5-5.8-5 7.6-.6Z" />
    </svg>
  );
}

function Clock() {
  return (
    <svg className="sv-zone-clock" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="var(--floor)" stroke="currentColor" strokeWidth="2" />
      <path d="M12 6.5V12l3.5 2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type ZoneProps = {
  state: ZoneState;
  /** xs 15px, sm 22px, md 52px (card width). Set `style={{ "--zw": "74px" }}` for any other width. */
  size?: "xs" | "sm" | "md";
  /** Becomes `aria-label` (and `role="img"`), and the tooltip text. */
  label?: string;
  /** Small text on the card (an opponent's initials, a round number). Hidden at `xs`. */
  children?: ReactNode;
  /** Make the zone a tab stop so keyboard users can see its tooltip. */
  focusable?: boolean;
  tipAlign?: TipAlign;
  style?: CSSProperties;
  className?: string;
};

/** A card-shaped slot (59:86) drawn in light. */
export function Zone({ state, size = "md", label, children, focusable = false, tipAlign = "center", style, className }: ZoneProps) {
  const a11y = label
    ? { role: "img", "aria-label": label, tabIndex: focusable ? 0 : undefined }
    : { "aria-hidden": true as const };
  return (
    <span className={sv("sv-zone", label && "sv-tipped", className)} data-state={state} data-size={size} data-align={tipAlign} data-side="top" style={style} {...a11y}>
      <span className="sv-zone-box">
        {(state === "won" || state === "lost" || state === "pending") && <span className="sv-zone-card" />}
        {state === "won" && <Star />}
        {children != null && <span className="sv-zone-fm">{children}</span>}
        {state === "pending" && <Clock />}
      </span>
      {label && <span className="sv-tip" aria-hidden="true">{label}</span>}
    </span>
  );
}

export type LocatorSlot = { state: ZoneState; label: string; children?: ReactNode };

/**
 * A row of Zones: five round slots, or three for single elimination. A bye is
 * `{ state: "dashed", label: "Bye" }`.
 */
export function LocatorStrip({ slots, size = "sm", label = "Round results", focusable = false, className }: {
  slots: LocatorSlot[];
  size?: "xs" | "sm";
  /** Accessible name of the whole strip. */
  label?: string;
  /** Make every slot a tab stop. Off by default so long lists do not add dozens of tab stops. */
  focusable?: boolean;
  className?: string;
}) {
  return (
    <ul className={sv("sv-locs", className)} data-size={size} aria-label={label}>
      {slots.map((slot, i) => (
        <li key={i}>
          <Zone
            state={slot.state}
            size={size}
            label={slot.label}
            focusable={focusable}
            tipAlign={slots.length > 1 ? (i === 0 ? "start" : i === slots.length - 1 ? "end" : "center") : "center"}
          >
            {slot.children}
          </Zone>
        </li>
      ))}
    </ul>
  );
}

/** D's flat field: a rounded rectangle of 1px beam lines, an optional centre line, a static low glow. */
export function FieldOutline({ lit = true, centreLine = false, children, className }: {
  lit?: boolean;
  centreLine?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={sv("sv-field", className)} data-lit={lit ? "true" : "false"} data-centre={centreLine ? "true" : undefined}>
      <div className="sv-field-body">{children}</div>
    </div>
  );
}
