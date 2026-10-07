"use client";

import { useDuelCardInfo } from "./card-info";
import { cardArtUrl, cardCombatText, cardDetailsText, cardKindText } from "./constants";
import styles from "./deck-card-preview.module.css";

export { loadDuelCardInfo } from "./card-info";

/** Large art and text of the deck card under the pointer, beside the deck lists. */
export function DeckCardPreview({ code, compact = false }: { code: number | null; compact?: boolean }) {
  const card = useDuelCardInfo(code);

  if (code == null) {
    return (
      <div className={styles.preview} data-compact={compact || undefined}>
        <p className={styles.hint}>Hover a card in your deck to see it here.</p>
      </div>
    );
  }

  const details = card ? cardDetailsText(card) : "";
  const kind = card ? cardKindText(card) : "";
  const combat = card ? cardCombatText(card) : "";
  const description = card?.description?.trim() ?? "";

  return (
    <div className={styles.preview} data-compact={compact || undefined} aria-live="polite">
      <div className={`${styles.art} card-frame`}>
        <img key={code} src={cardArtUrl(code, "full")} alt={card?.name ?? `Card ${code}`} />
      </div>
      <div className={styles.body}>
        <h2 className={styles.name}>{card?.name ?? (card === null ? `Card ${code}` : " ")}</h2>
        {details || (kind && kind !== details) || combat ? (
          <div className={styles.facts}>
            {details ? <p>{details}</p> : null}
            {kind && kind !== details ? <p>{kind}</p> : null}
            {combat ? <p className={styles.combat}>{combat}</p> : null}
          </div>
        ) : null}
        {description ? <p className={styles.text}>{description}</p> : null}
        <p className={styles.code}>{code}</p>
      </div>
    </div>
  );
}
