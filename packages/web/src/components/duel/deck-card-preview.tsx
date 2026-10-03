"use client";

import { useEffect, useState } from "react";
import type { DuelCardInfo } from "@yugidraft/shared/duels";
import { searchDuelCards } from "./api";
import { cardArtUrl, cardCombatText, cardDetailsText, cardKindText } from "./constants";
import styles from "./deck-card-preview.module.css";

const infoCache = new Map<number, Promise<DuelCardInfo | null>>();

/** Card text for a passcode, from the duel host's card database. Cached per page load. */
export function loadDuelCardInfo(code: number): Promise<DuelCardInfo | null> {
  let pending = infoCache.get(code);
  if (!pending) {
    pending = searchDuelCards(String(code)).then(
      ({ cards }) => cards.find((card) => card.code === code) ?? null,
      () => {
        infoCache.delete(code);
        return null;
      },
    );
    infoCache.set(code, pending);
  }
  return pending;
}

/** undefined while loading, null when the card is unknown. */
function useCardInfo(code: number | null): DuelCardInfo | null | undefined {
  const [loaded, setLoaded] = useState<{ code: number; card: DuelCardInfo | null } | null>(null);
  useEffect(() => {
    if (code == null) return undefined;
    let live = true;
    void loadDuelCardInfo(code).then((card) => {
      if (live) setLoaded({ code, card });
    });
    return () => {
      live = false;
    };
  }, [code]);
  return code != null && loaded?.code === code ? loaded.card : undefined;
}

/** Large art and text of the deck card under the pointer, beside the deck lists. */
export function DeckCardPreview({ code }: { code: number | null }) {
  const card = useCardInfo(code);

  if (code == null) {
    return (
      <div className={styles.preview}>
        <div className={styles.artEmpty} aria-hidden />
        <p className={styles.hint}>Hover a card in your deck to see it here.</p>
      </div>
    );
  }

  const details = card ? cardDetailsText(card) : "";
  const kind = card ? cardKindText(card) : "";
  const combat = card ? cardCombatText(card) : "";
  const description = card?.description?.trim() ?? "";

  return (
    <div className={styles.preview} aria-live="polite">
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
