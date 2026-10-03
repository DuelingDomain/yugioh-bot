import type { CSSProperties } from "react";
import styles from "./editor.module.css";

export function sizeState(count: number, minimum: number, maximum: number): "ok" | "under" | "over" {
  return count < minimum ? "under" : count > maximum ? "over" : "ok";
}

/** The fill shows the count; the gold bracket marks the legal range. */
export function DeckSizeMeter({ title, count, minimum, maximum }: { title: string; count: number; minimum: number; maximum: number }) {
  const range = minimum === maximum ? `exactly ${minimum}` : minimum === 0 ? `up to ${maximum}` : `${minimum} to ${maximum}`;
  return (
    <span className={styles["de-ruler"]} role="img" data-s={sizeState(count, minimum, maximum)} aria-label={`${title} ${count} ${count === 1 ? "card" : "cards"}. Tables want ${range}.`} style={{ "--n": count, "--lo": minimum, "--hi": maximum, "--max": maximum > 15 ? 64 : 16 } as CSSProperties}>
      <span className={styles["de-band"]} />
      <span className={styles["de-mark"]} />
    </span>
  );
}
