import { SizeBar } from "@/components/sheet";
import styles from "./editor.module.css";

export function sizeState(count: number, minimum: number, maximum: number): "ok" | "under" | "over" {
  return count < minimum ? "under" : count > maximum ? "over" : "ok";
}

/**
 * A section's size on the kit's size bar: the fill is the count, the two ticks are the legal range.
 * The bar names itself for assistive tech; the count and target sit beside it, so its own header stays hidden.
 */
export function DeckSizeMeter({ title, count, minimum, maximum }: { title: string; count: number; minimum: number; maximum: number }) {
  const range = minimum === maximum ? `exactly ${minimum}` : minimum === 0 ? `up to ${maximum}` : `${minimum} to ${maximum}`;
  return (
    <SizeBar
      className={styles["de-size"]}
      label={`${title} ${count} ${count === 1 ? "card" : "cards"}. Tables want ${range}.`}
      value={count}
      min={minimum}
      max={maximum}
    />
  );
}
