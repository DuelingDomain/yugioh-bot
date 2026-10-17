import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import styles from "./edge-drawer.module.css";

export type EdgeSide = "left" | "right" | "bottom";
export type EdgeTone = "violet" | "gold";

/** The count shown in the badge: 1 to 99, then "99+". Zero, negative and non-numbers show nothing. */
export function formatTabCount(count: number | undefined): string | null {
  if (count === undefined || !Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

export interface EdgeTabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  side: EdgeSide;
  /** Short word on the tab, also the accessible name. */
  label: string;
  icon?: ReactNode;
  /** True when there is something new or important behind the tab. Draws the subtle glow. */
  attention?: boolean;
  /** A number of new items. Shown as a small badge. */
  count?: number;
  /** Accent for the glow and badge. Violet by default; gold for "you can act". */
  tone?: EdgeTone;
  /** The drawer is open (aria-expanded). */
  open?: boolean;
  /** The id of the drawer panel (aria-controls). */
  controlsId?: string;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * The small tab on the screen edge that opens a drawer. It is a plain button, so Enter and Space work and
 * it takes focus. When `attention` is true it glows softly (one brighter beat as it turns on, then a steady
 * glow; no loop, and no beat under reduced motion). Use it on its own only for a drawer you build yourself;
 * `EdgeDrawer` renders one for you.
 */
export function EdgeTab({ side, label, icon, attention = false, count, tone = "violet", open = false, controlsId, ref, className, type, ...rest }: EdgeTabProps) {
  const badge = formatTabCount(count);
  return (
    <button
      {...rest}
      ref={ref}
      type={type ?? "button"}
      className={className ? `${styles.tab} ${className}` : styles.tab}
      data-side={side}
      data-tone={tone}
      data-attention={attention ? "true" : "false"}
      aria-expanded={open}
      aria-controls={controlsId}
    >
      {icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
      <span className={styles.label}>{label}</span>
      {badge ? <span className={styles.count} aria-hidden="true">{badge}</span> : null}
      {badge || attention ? (
        <span className={styles.srOnly}>{badge ? `${badge} new` : "new"}</span>
      ) : null}
    </button>
  );
}
