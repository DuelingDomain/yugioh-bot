import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { TierName } from "./rank-gem";
import { sv } from "./sv-util";

function defaultInitials(name: string): string {
  const letters = [...name.trim()].slice(0, 2);
  if (letters.length === 0) return "";
  letters[0] = letters[0].toUpperCase();
  return letters.join("");
}

export type MonoProps = {
  name: string;
  /** Defaults to the first two characters of `name`, first one capitalised. */
  initials?: string;
  size?: "sm" | "md" | "big";
  /** Any CSS colour, normally the player's ring colour. */
  ring?: string;
  /** Violet ring. Wins over `ring`. */
  you?: boolean;
  /** Gold ring with a static glow. */
  champion?: boolean;
  /** The empty-seat ring: dashed, no initials. */
  dashed?: boolean;
  /** Gives the ring an accessible name. Without it the ring is decorative (the name is usually beside it). */
  label?: string;
  className?: string;
};

/** A monogram ring, 26 (`sm`), 36 (`md`, default) or 52 (`big`) px. */
export function Mono({ name, initials, size = "md", ring, you = false, champion = false, dashed = false, label, className }: MonoProps) {
  const style = ring ? ({ "--sv-ring": ring } as CSSProperties) : undefined;
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <span
      className={sv("sv-mono", className)}
      data-size={size}
      data-you={you ? "true" : undefined}
      data-champion={champion ? "true" : undefined}
      data-dashed={dashed ? "true" : undefined}
      style={style}
      {...a11y}
    >
      {dashed ? null : initials ?? defaultInitials(name)}
    </span>
  );
}

/** The quiet violet "You" pill. */
export function YouPill({ className }: { className?: string }) {
  return <span className={sv("sv-pill", className)}>You</span>;
}

export type SeatProps = {
  name: string;
  href?: string;
  tier?: string;
  elo?: number;
  you?: boolean;
  ring?: string;
  size?: "sm" | "md";
  /** Content pushed to the right end of the seat (a score, a button, a note). */
  trailing?: ReactNode;
  initials?: string;
  className?: string;
};

/** A monogram ring, the name (with a "You" pill for you), and a line with the gem, tier word and Elo. */
export function Seat({ name, href, tier, elo, you = false, ring, size = "md", trailing, initials, className }: SeatProps) {
  const hasLine = tier !== undefined || elo !== undefined;
  return (
    <div className={sv("sv-seat", className)} data-size={size} data-you={you ? "true" : undefined}>
      <Mono name={name} initials={initials} size={size} ring={ring} you={you} />
      <div className="sv-seat-t">
        <span className="sv-seat-name">
          {href ? <Link href={href}>{name}</Link> : <b>{name}</b>}
          {you && <YouPill />}
        </span>
        {hasLine && (
          <span className="sv-seat-line">
            {tier !== undefined && <TierName tier={tier} />}
            {elo !== undefined && <em className="sv-elo">{elo}</em>}
          </span>
        )}
      </div>
      {trailing != null && trailing !== false && <div className="sv-seat-trail">{trailing}</div>}
    </div>
  );
}

