"use client";

import { useState, type ReactNode } from "react";
import type { DeckCardInfo } from "@yugidraft/shared/duels";
import { TYPE_PENDULUM, cardArtUrl, cardCombatText, cardDetailsText, cardKindText } from "@/components/duel/constants";
import { cn } from "@/lib/utils";
import { CardArt } from "./card-art";
import styles from "./card-preview.module.css";

function scaleText(card: DeckCardInfo): string | null {
  if ((card.type & TYPE_PENDULUM) === 0) return null;
  return card.lscale === card.rscale ? `Scale ${card.lscale}` : `Scale ${card.lscale} / ${card.rscale}`;
}

/**
 * The large card view in the left pane, sized so the card text is easy to read. The small art
 * (already cached by the card tiles) shows at once; the full art replaces it when it loads.
 */
export function CardPreview({ card, compact = false, copySummary }: { card: DeckCardInfo; compact?: boolean; copySummary?: ReactNode }) {
  // Kept for every card shown, so a card shown again does not fade in a second time.
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(() => new Set());
  const [failed, setFailed] = useState<ReadonlySet<number>>(() => new Set());
  const details = cardDetailsText(card);
  const kind = cardKindText(card);
  const scale = scaleText(card);
  const combat = cardCombatText(card);
  const text = card.description.trim();

  return (
    <article className={styles["de-card"]} data-compact={compact || undefined}>
      <div className={cn(styles["de-art"], styles.art, "card-frame")}>
        <CardArt code={card.code} name={card.name} />
        {failed.has(card.code) ? null : (
          <img
            key={card.code}
            className={styles.full}
            src={cardArtUrl(card.code, "full")}
            alt=""
            draggable={false}
            data-loaded={loaded.has(card.code) ? "true" : undefined}
            onLoad={() => setLoaded((codes) => new Set(codes).add(card.code))}
            onError={() => setFailed((codes) => new Set(codes).add(card.code))}
          />
        )}
      </div>
      <h2 className={styles["de-cn"]}>{card.name}</h2>
      <div className={styles["de-facts"]}>
        {details ? <p>{details}</p> : null}
        {kind && kind !== details ? <p>{kind}</p> : null}
        {scale ? <p>{scale}</p> : null}
        {combat ? <p className="num">{combat}</p> : null}
      </div>
      {copySummary ? <div className={styles.copySummary}>{copySummary}</div> : null}
      {text ? <p className={styles["de-text"]}>{text}</p> : null}
      <p className={styles["de-pc"]}>Passcode <span className="num">{card.code}</span></p>
    </article>
  );
}
