"use client";

import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";
import { CardBack } from "./card-face";
import {
  cardArtUrl,
  cardCombatText,
  cardDetailsText,
  cardKindText,
  isHiddenCard,
} from "./constants";
import styles from "./inspector.module.css";

export type InspectTarget =
  | { type: "card"; card: DuelCard }
  | { type: "info"; card: DuelCardInfo }
  | { type: "pile"; title: string; cards: DuelCard[] };

function InfoBody({ card }: { card: DuelCard | DuelCardInfo }) {
  const code = card.code;
  if (isHiddenCard(card) || code == null) {
    return (
      <div className={styles.root}>
        <div className={styles.art}>
          <CardBack className={styles.artBack} />
        </div>
        <p className={styles.details}>Face-down card.</p>
      </div>
    );
  }

  const details = cardDetailsText(card);
  const kind = cardKindText(card);
  const combat = cardCombatText(card);
  const description = card.description?.trim() ?? "";

  return (
    <div className={styles.root}>
      <div className={styles.art}>
        <img src={cardArtUrl(code, "full")} alt="" />
      </div>
      <div className={styles.body}>
        <h2 className={styles.name}>{card.name ?? `Card ${card.code}`}</h2>
        {details || (kind && kind !== details) || combat ? (
          <div className={styles.facts}>
            {details ? <p className={styles.details}>{details}</p> : null}
            {kind && kind !== details ? <p className={styles.kind}>{kind}</p> : null}
            {combat ? <p className={styles.combat}>{combat}</p> : null}
          </div>
        ) : null}
        {description ? <p className={styles.text}>{description}</p> : null}
      </div>
    </div>
  );
}

export function CardInspector({
  target,
  onInspectCard,
  onActivateCard,
}: {
  target: InspectTarget | null;
  onInspectCard?: (card: DuelCard) => void;
  onActivateCard?: (card: DuelCard, anchor: HTMLElement) => void;
}) {
  if (!target) {
    return <div className={styles.empty}>Select a card to inspect.</div>;
  }

  if (target.type === "pile") {
    return (
      <div className={styles.root}>
        <h2 className={styles.pileTitle}>{target.title}</h2>
        {target.cards.length === 0 ? (
          <p className={styles.details}>Empty.</p>
        ) : (
          <ul className={styles.pileGrid}>
            {target.cards.map((card, index) => {
              const hidden = isHiddenCard(card);
              const label = hidden ? "Face-down card" : (card.name ?? `Card ${card.code}`);
              return (
                <li key={`${card.controller}-${card.location}-${card.sequence}-${index}`}>
                  <button
                    type="button"
                    className={styles.pileCard}
                    aria-label={label}
                    onClick={(event) => {
                      if (onActivateCard) onActivateCard(card, event.currentTarget);
                      else onInspectCard?.(card);
                    }}
                  >
                    {hidden || card.code == null ? (
                      <CardBack />
                    ) : (
                      <img src={cardArtUrl(card.code, "small")} alt="" draggable={false} />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  if (target.type === "info") {
    return <InfoBody card={target.card} />;
  }

  const extras: string[] = [];
  if (target.card.counters?.length) {
    for (const counter of target.card.counters) {
      extras.push(`Counter ${counter.type}: ${counter.count}`);
    }
  }
  if (target.card.materials?.length) {
    extras.push(
      `Materials: ${target.card.materials
        .map((material) => (material.code == null ? "face-down" : (material.name ?? `Card ${material.code}`)))
        .join(", ")}`,
    );
  }

  return (
    <>
      <InfoBody card={target.card} />
      {extras.length > 0 ? (
        <ul className={styles.metaList}>
          {extras.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
