"use client";

import { useState } from "react";
import type { DeckCardInfo } from "@yugidraft/shared/duels";
import { TYPE_PENDULUM, cardArtUrl, cardCombatText, cardDetailsText, cardKindText } from "@/components/duel/constants";
import { cx } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
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
export function CardPreview({ card }: { card: DeckCardInfo }) {
  // Kept for every card shown, so a card shown again does not fade in a second time.
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(() => new Set());
  const [failed, setFailed] = useState<ReadonlySet<number>>(() => new Set());
  const details = cardDetailsText(card);
  const kind = cardKindText(card);
  const scale = scaleText(card);
  const combat = cardCombatText(card);
  const text = card.description.trim();

  return (
    <article className={styles.preview}>
      <div className={styles.art}>
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
      <h2 className={styles.name}>{card.name}</h2>
      <div className={styles.facts}>
        {details ? <p>{details}</p> : null}
        {kind && kind !== details ? <p>{kind}</p> : null}
        {scale ? <p>{scale}</p> : null}
        {combat ? <p className={cx(ui.num, styles.combat)}>{combat}</p> : null}
      </div>
      {text ? <p className={styles.text}>{text}</p> : null}
      <p className={styles.code}>Passcode <span className={ui.num}>{card.code}</span></p>
    </article>
  );
}
