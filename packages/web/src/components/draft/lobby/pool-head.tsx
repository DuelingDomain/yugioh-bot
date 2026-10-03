import { SectionHead } from "@/components/sheet";
import { plural } from "./lobby-model";
import styles from "./lobby.module.css";

/**
 * The "Card pool" heading with its count. The pool panel draws its own count joined with a middle dot, so the panel's
 * heading is hidden (see `.poolWrap`) and this one stands in: "118 cards, 1 set".
 */
export function PoolHead({ cards, loading, detail }: { cards: { qty?: number }[]; loading?: boolean; detail?: string }) {
  const distinct = cards.length;
  const copies = cards.reduce((sum, c) => sum + (c.qty ?? 1), 0);
  const note = [
    plural(distinct, "card"),
    copies > distinct ? plural(copies, "copy", "copies") : null,
    detail || null,
    loading ? "resolving…" : null,
  ].filter(Boolean).join(", ");
  return (
    <div className={styles.poolHead} aria-live="polite">
      <SectionHead title="Card pool" note={note} />
    </div>
  );
}
