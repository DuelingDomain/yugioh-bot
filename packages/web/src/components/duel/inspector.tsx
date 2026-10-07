"use client";

import type { CSSProperties } from "react";
import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";
import { CardBack } from "./card-face";
import { hasCardName, useDuelCardInfo } from "./card-info";
import { cardTextStyle, useCardTextSize } from "./card-text-size";
import {
  cardArtUrl,
  cardCombatText,
  cardDetailsText,
  cardKindText,
  isHiddenCard,
} from "./constants";
import { equipSentence, roleOfCard, type EquipLinks } from "./equip-links";
import baseStyles from "./inspector.module.css";
import { useSkinStyles } from "./skin";

export type InspectTarget =
  | { type: "card"; card: DuelCard }
  | { type: "info"; card: DuelCardInfo }
  | { type: "pile"; title: string; cards: DuelCard[] };

function InfoBody({ card: liveCard }: { card: DuelCard | DuelCardInfo }) {
  const styles = useSkinStyles(baseStyles, "inspector");
  const textSize = useCardTextSize();
  const textStyle = cardTextStyle(textSize);
  const code = liveCard.code;
  const hidden = isHiddenCard(liveCard) || code == null;
  const resolved = useDuelCardInfo(!hidden && (!hasCardName(liveCard) || !liveCard.description?.trim()) ? code : null);
  // Fill static text while retaining ATK/DEF, counters and other live fields.
  const card = resolved ? {
    ...resolved, ...liveCard,
    canonicalPasscode: liveCard.canonicalPasscode ?? resolved.canonicalPasscode,
    type: liveCard.type ?? resolved.type,
    attack: liveCard.attack ?? resolved.attack,
    defense: liveCard.defense ?? resolved.defense,
    level: liveCard.level ?? resolved.level,
    attribute: liveCard.attribute ?? resolved.attribute,
    race: liveCard.race ?? resolved.race,
    name: hasCardName(liveCard) ? liveCard.name : resolved.name,
    description: liveCard.description?.trim() ? liveCard.description : resolved.description,
  } : liveCard;
  if (hidden) {
    return (
      <div className={styles.root} data-card-text={textSize} style={textStyle}>
        <div className={`${styles.art} card-frame`}>
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
    <div className={styles.root} data-card-text={textSize} style={textStyle}>
      <div className={`${styles.art} card-frame`}>
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

/** The seat that owns a card, for tables of 3 or more seats: the inspector adds an "Owner" line in the seat colour. */
export type InspectorOwner = { name: string; tone: { main: string; ink: string } };

export function CardInspector({
  target,
  onInspectCard,
  onActivateCard,
  equipLinks,
  ownerOf,
}: {
  target: InspectTarget | null;
  onInspectCard?: (card: DuelCard) => void;
  onActivateCard?: (card: DuelCard, anchor: HTMLElement) => void;
  /** The equip links of the live board: adds "Equipped to ..." / "Equipped with ..." for a card on the field. */
  equipLinks?: EquipLinks;
  /** 3 and 4 seat tables: who owns the card shown. Absent: no owner line (1v1). */
  ownerOf?: (card: DuelCard) => InspectorOwner | null;
}) {
  const styles = useSkinStyles(baseStyles, "inspector");
  const textSize = useCardTextSize();
  const textStyle = cardTextStyle(textSize);
  if (!target) {
    return <div className={styles.empty} style={textStyle}>Select a card to inspect.</div>;
  }

  if (target.type === "pile") {
    return (
      <div className={styles.root} data-card-text={textSize} style={textStyle}>
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
  const equipText = equipLinks ? equipSentence(roleOfCard(equipLinks, target.card)) : null;
  if (equipText) extras.push(equipText);
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

  const owner = ownerOf?.(target.card) ?? null;
  return (
    <>
      <InfoBody card={target.card} />
      {owner ? (
        <p
          className={styles.owner}
          data-testid="inspector-owner"
          style={{ ...textStyle, "--seat-main": owner.tone.main, "--seat-ink": owner.tone.ink } as CSSProperties}
        >
          <i aria-hidden="true" />
          Owner <b>{owner.name}</b>
        </p>
      ) : null}
      {extras.length > 0 ? (
        <ul className={styles.metaList} style={textStyle}>
          {extras.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
