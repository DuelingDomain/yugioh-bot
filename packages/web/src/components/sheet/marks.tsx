import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function LivePill({ children = "Live", className }: { children?: ReactNode; className?: string }) {
  return <span className={cn("live-pill", className)}>{children}</span>;
}

export function NewChip({ children = "New", className }: { children?: ReactNode; className?: string }) {
  return <span className={cn("chip-new", className)}>{children}</span>;
}

// The duel's chain link, from the boards.
function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g transform="rotate(-40 12 12)" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
        <rect x="1.5" y="8" width="12" height="8" rx="4" />
        <rect x="10.5" y="8" width="12" height="8" rx="4" />
      </g>
    </svg>
  );
}

/** Numbered badge. gold chain = a reply someone owes, purple pen = you, red live = live. */
export function ChainMedallion({ tone = "chain", size = "md", count, icon, label, className }: {
  tone?: "chain" | "pen" | "live";
  size?: "md" | "sm" | "xs";
  count?: number;
  icon?: ReactNode;
  label?: string;
  className?: string;
}) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <span
      className={cn("cm", size !== "md" && size, className)}
      data-tone={tone === "chain" ? undefined : tone}
      {...a11y}
    >
      {icon ?? <LinkIcon />}
      {count != null && <b>{count}</b>}
    </span>
  );
}

/** The end-of-match wordmark. */
export function Stamp({ children, loss = false, as = "p", className }: {
  children: ReactNode;
  loss?: boolean;
  as?: "p" | "span" | "div";
  className?: string;
}) {
  const As = as;
  return <As className={cn("stamp", loss && "loss", className)}>{children}</As>;
}

/** Tier-coloured meter. `value` is 0 to 1 and is clamped. */
export function TierMeter({ tier, value, label, className }: {
  tier?: string;
  value: number;
  label?: string;
  className?: string;
}) {
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const pct = `${Math.round(v * 1000) / 10}%`;
  return (
    <span
      className={cn("meter", className)}
      data-t={tier}
      role="img"
      aria-label={label ?? (tier ? `${tier} meter` : "Meter")}
    >
      <i style={{ width: pct } as CSSProperties} />
    </span>
  );
}

/** Summoning circle that turns behind an unlock, then stops (see `.smn` in the stylesheet). */
export function SummonCircle({ className }: { className?: string }) {
  return (
    <span className={cn("smn", className)} aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <g className="r1">
          <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="0.8" strokeDasharray="1.5 5" />
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="0.6" />
        </g>
        <g className="r2">
          <path d="M50 12 L83 69 L17 69 Z M50 88 L17 31 L83 31 Z" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.55" />
        </g>
      </svg>
    </span>
  );
}
