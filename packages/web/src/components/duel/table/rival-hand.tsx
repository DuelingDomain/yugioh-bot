"use client";

import type { CSSProperties } from "react";
import { CardBack } from "../card-face";
import { LOCATION_HAND, zoneKey } from "../constants";
import styles from "./rival-hand.module.css";

/** Most card backs drawn in a fan. A larger hand shows the count chip only. */
export const MAX_RIVAL_BACKS = 12;

/**
 * A rival's hand: a fan of card backs at the owner's back edge, with a count chip. The owner's cards are never
 * shown. It carries `data-hand-seat` so the effects can find where a card leaves or enters this hand. It sits
 * inside the seat field, so it turns and scales with the field. Place it in a `position: relative` parent
 * that sets the zone size `--z` and the card width `--cw`.
 *
 * Each drawn back carries the anchors of a 1v1 hand card (`data-hand-id` of the sleeve, the hand zone key), so a card
 * that returns to this hand (Storming Mirror Force, a bounce) flies to its back and lands on it. A hand of more than
 * `MAX_RIVAL_BACKS` has no back for the last cards; the size probe next to the fan gives them the card size to land on.
 */
export function RivalHand({ seat, count, name, cards }: { seat: number; count: number; name: string; cards?: ReadonlyArray<{ handId?: string; sequence?: number }> }) {
  const shown = Math.max(0, Math.min(MAX_RIVAL_BACKS, count));
  const vars = { "--hn": shown } as CSSProperties;
  return (
    <>
      <div
        className={styles.backs}
        role="group"
        aria-label={`${name} hand, ${count} ${count === 1 ? "card" : "cards"}`}
        data-hand-seat={seat}
        data-side="opp"
        data-count={count}
        style={vars}
      >
        {Array.from({ length: shown }, (_, index) => {
          const card = cards?.[index];
          return (
            <span key={card?.handId ?? index} className={styles.hb} data-hand-id={card?.handId} data-hand-card="true">
              <div data-zones={zoneKey(seat, LOCATION_HAND, card?.sequence ?? index)} data-side="opp">
                <CardBack />
              </div>
            </span>
          );
        })}
        <span className={styles.count} aria-hidden="true">{count}</span>
      </div>
      <div className={styles.probe} data-hand-size-probe="true" data-side="opp" aria-hidden="true" />
    </>
  );
}
