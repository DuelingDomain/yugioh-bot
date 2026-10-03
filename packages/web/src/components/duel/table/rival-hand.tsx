"use client";

import type { CSSProperties } from "react";
import { CardBack } from "../card-face";
import styles from "./rival-hand.module.css";

/** Most card backs drawn in a fan. A larger hand shows the count chip only. */
export const MAX_RIVAL_BACKS = 12;

/**
 * A rival's hand: a fan of card backs at the owner's back edge, with a count chip. The owner's cards are never
 * shown. It carries `data-hand-seat` so the effects can find where a card leaves or enters this hand. It sits
 * inside the seat field, so it turns and scales with the field. Place it in a `position: relative` parent
 * that sets the zone size `--z` and the card width `--cw`.
 */
export function RivalHand({ seat, count, name }: { seat: number; count: number; name: string }) {
  const shown = Math.max(0, Math.min(MAX_RIVAL_BACKS, count));
  const vars = { "--hn": shown } as CSSProperties;
  return (
    <div
      className={styles.backs}
      role="group"
      aria-label={`${name} hand, ${count} ${count === 1 ? "card" : "cards"}`}
      data-hand-seat={seat}
      data-side="opp"
      data-count={count}
      style={vars}
    >
      {Array.from({ length: shown }, (_, index) => (
        <span key={index} className={styles.hb}>
          <CardBack />
        </span>
      ))}
      <span className={styles.count} aria-hidden="true">{count}</span>
    </div>
  );
}
