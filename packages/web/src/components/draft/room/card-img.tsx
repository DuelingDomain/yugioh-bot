"use client";

import { cardImageUrl } from "@/lib/card-image-url";
import { useEffect, useRef, useState } from "react";
import type { RoomCard } from "./room-model";

/**
 * A card image from the card cache. If the small one fails it tries the large one, then shows the name.
 * With `placeholder` the card shows a card back until the picture arrives, then the picture fades in.
 */
export function CardImg({
  card,
  large = false,
  crop = false,
  eager = false,
  placeholder,
  className,
}: {
  card: RoomCard;
  large?: boolean;
  crop?: boolean;
  /** Load now instead of when scrolled near: for the reader, which swaps as the pointer sweeps. */
  eager?: boolean;
  /** Which card back to show while the picture loads. Without it the image area stays empty until the picture is ready. */
  placeholder?: "main" | "extra";
  className?: string;
}) {
  const cls = `${crop ? "crop " : ""}${className ?? ""}`.trim() || undefined;
  const first = cardImageUrl(card.passcode ?? card.id, large ? "full" : "small");
  const second = cardImageUrl(card.passcode ?? card.id, large ? "small" : "full");
  const [tries, setTries] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const src = tries === 0 ? first : tries === 1 && second && second !== first ? second : null;
  // A picture that came from the browser cache can finish before React attaches onLoad.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, [src]);
  if (!src) {
    return (
      <span className={`img-miss ${className ?? ""}`} role="img" aria-label={card.name}>
        {card.name}
      </span>
    );
  }
  return (
    <>
      {placeholder && !loaded ? (
        <span className={`img-wait${placeholder === "extra" ? " x" : ""}`} data-loading="" aria-hidden="true" />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        className={cls}
        src={src}
        alt=""
        draggable={false}
        loading={eager ? "eager" : "lazy"}
        data-loaded={loaded ? "" : undefined}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          setTries((t) => t + 1);
        }}
      />
    </>
  );
}

export const ARROW = (
  <svg viewBox="0 0 18 12" aria-hidden="true">
    <path d="M17 6H2m5-5L2 6l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
