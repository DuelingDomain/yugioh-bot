import { Ban } from "lucide-react";
import styles from "./editor.module.css";

const LIMIT_NAMES = ["Forbidden", "Limited", "Semi-Limited"] as const;

/** Banlist mark on a card tile: a ban sign, 1 or 2. Unlimited cards show nothing. */
export function LimitBadge({ limit }: { limit: 0 | 1 | 2 | 3 }) {
  if (limit === 3) return null;
  return (
    <span className={styles["de-lim"]} data-l={limit} title={LIMIT_NAMES[limit]}>
      {limit === 0 ? <Ban size={11} strokeWidth={2.4} aria-hidden /> : limit}
    </span>
  );
}

export function limitName(limit: 0 | 1 | 2 | 3): string | null {
  return limit === 3 ? null : LIMIT_NAMES[limit];
}
