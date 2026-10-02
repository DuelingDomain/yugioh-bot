"use client";

import { useState } from "react";
import type { RoomCard } from "./room-model";

/** A card image from the card cache. If the small one fails it tries the large one, then shows the name. */
export function CardImg({ card, large = false, crop = false, className }: { card: RoomCard; large?: boolean; crop?: boolean; className?: string }) {
  const cls = `${crop ? "crop " : ""}${className ?? ""}`.trim() || undefined;
  const first = large ? card.imageUrl || card.imageUrlSmall : card.imageUrlSmall || card.imageUrl;
  const second = large ? card.imageUrlSmall : card.imageUrl;
  const [tries, setTries] = useState(0);
  const src = tries === 0 ? first : tries === 1 && second && second !== first ? second : null;
  if (!src) {
    return (
      <span className={`img-miss ${className ?? ""}`} role="img" aria-label={card.name}>
        {card.name}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={cls}
      src={src}
      alt=""
      draggable={false}
      loading="lazy"
      onError={() => setTries((t) => t + 1)}
    />
  );
}

export const ARROW = (
  <svg viewBox="0 0 18 12" aria-hidden="true">
    <path d="M17 6H2m5-5L2 6l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
