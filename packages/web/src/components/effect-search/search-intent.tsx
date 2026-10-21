"use client";

import { cardImageUrl } from "@/lib/card-image-url";
import type { EffectIntent } from "./effect-api";
import styles from "./search-intent.module.css";

/** "No exact match. Remove <chip> → N cards": one button per chip, each the same as that chip's x. */
export function RelaxHints({ relax, onRemove, testId = "relax-hints" }: { relax: ReadonlyArray<{ chip: string; count: number }> | undefined; onRemove: (chip: string) => void; testId?: string }) {
  if (!relax?.length) return null;
  return (
    <div className={styles.relax} role="group" aria-label="Widen the search" data-testid={testId}>
      <p className={styles.relaxLead}>No exact match.</p>
      <ul className={styles.relaxList}>
        {relax.map(({ chip, count }) => (
          <li key={chip}>
            <button type="button" className={styles.relaxBtn} data-testid="relax-hint" onClick={() => onRemove(chip)}>
              <span className={styles.relaxText}>Remove <strong>{chip}</strong></span>
              <span className={styles.relaxCount}>→ {count.toLocaleString("en-US")} {count === 1 ? "card" : "cards"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The title over a "cards like X" or "how to beat X" search. */
export function intentTitle(intent: EffectIntent): string {
  switch (intent.kind) {
    case "similar": return `Cards like ${intent.name}`;
    case "counters": return `How to beat ${intent.archetype}`;
    case "outside": return `Cards for ${intent.archetype} decks`;
    case "archetype_role": return `For ${intent.archetype} decks`;
    case "staples": return "Format staples";
  }
}

export function IntentHeading({ intent, count, testId = "intent-heading" }: { intent: EffectIntent; count?: number; testId?: string }) {
  return (
    <div className={styles.intent} data-testid={testId} data-kind={intent.kind}>
      {intent.kind === "similar" ? <img className={styles.art} src={cardImageUrl(intent.passcode, "small")} alt="" loading="lazy" /> : null}
      <h3 className={styles.intentTitle}>{intentTitle(intent)}</h3>
      {count !== undefined ? <span className={styles.intentCount}>{count.toLocaleString("en-US")} {count === 1 ? "card" : "cards"}</span> : null}
    </div>
  );
}
