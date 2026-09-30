"use client";

import type { DuelCard } from "@yugidraft/shared/duels";
import { cn } from "@/lib/utils";
import {
  cardArtUrl,
  cardStatsText,
  isDefense,
  isFacedown,
  LOCATION_EXTRA,
  LOCATION_HAND,
  LOCATION_MZONE,
} from "./constants";
import styles from "./field.module.css";

export function CardBack({
  className,
  kind = "deck",
}: {
  className?: string;
  kind?: "deck" | "extra";
}) {
  return (
    <div
      className={cn(styles.cardBack, kind === "extra" && styles.cardBackExtra, className)}
      data-card-art
      aria-hidden="true"
    />
  );
}

export function CardFace({
  card,
  location,
  sleeve,
  reveal,
  className,
}: {
  card: DuelCard | null;
  location?: number;
  sleeve?: "deck" | "extra";
  /** Show the art whenever the server sent an identity, even if the card is face-down (own Extra Deck, Graveyard). */
  reveal?: boolean;
  className?: string;
}) {
  const loc = location ?? card?.location;
  const known = card?.code != null;
  const setDown = isFacedown(card?.position);
  const inHand = loc === LOCATION_HAND;
  const showArt = known && (inHand || reveal || !setDown);
  const defensePos = loc === LOCATION_MZONE && isDefense(card?.position);
  const overlays = showArt ? card?.materials?.length ?? 0 : 0;

  return (
    <div className={cn(styles.artWrap, className)} data-defense={defensePos ? "true" : "false"}>
      {showArt && card?.code != null ? (
        <div className={styles.cardFace} data-card-art data-defense={defensePos ? "true" : "false"}>
          <img src={cardArtUrl(card.code, "small")} alt="" className={styles.art} draggable={false} />
        </div>
      ) : (
        <CardBack kind={sleeve ?? (loc === LOCATION_EXTRA ? "extra" : "deck")} />
      )}
      {overlays > 0 ? <span className={styles.overlayBadge}>{overlays}</span> : null}
    </div>
  );
}

export function cardFieldStats(card: DuelCard | null, showStats: boolean | undefined): string | null {
  if (!card || !showStats) return null;
  if (isFacedown(card.position) && card.location !== LOCATION_HAND) return null;
  if (card.code == null) return null;
  return cardStatsText(card);
}
