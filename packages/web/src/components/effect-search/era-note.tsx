import type { CardEra } from "@yugidraft/shared/cards/effects";
import { eraNote } from "./effect-api";
import styles from "./effect-search.module.css";

/** A small muted line: results lean toward the cube's release years. A health note about much newer cards can follow it. */
export function EraNote({ era, warning }: { era: CardEra; warning?: string }) {
  return (
    <div className={styles.eraNote} data-testid="era-note">
      <p role="note">{eraNote(era)}</p>
      {warning ? <p>{warning}</p> : null}
    </div>
  );
}
