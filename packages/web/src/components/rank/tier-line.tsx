import type { CSSProperties } from "react";
import styles from "./tier-line.module.css";

const TIER_VAR: Record<string, string> = {
  Bronze: "var(--t-bronze)",
  Silver: "var(--t-silver)",
  Gold: "var(--t-gold)",
  Platinum: "var(--t-plat)",
  Diamond: "var(--t-dia)",
};

/**
 * Progress through a tier, drawn as a thin light line with a node at the current Elo.
 * `value` is 0 to 1. The fill grows with a transform; the line is the same height everywhere.
 */
export function TierLine({ tier, value, label, className }: { tier: string; value: number; label: string; className?: string }) {
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  const style = { "--f": v, "--tier": TIER_VAR[tier] ?? "var(--pen-ink)" } as CSSProperties;
  return (
    <span className={`${styles.line}${className ? ` ${className}` : ""}`} style={style} role="img" aria-label={label}>
      <i className={styles.fill} />
      <i className={styles.node} />
    </span>
  );
}
