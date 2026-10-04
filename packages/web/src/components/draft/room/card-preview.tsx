"use client";

/**
 * A large, flat copy of the card under the pointer (or the keyboard), floating just above it on desktop.
 * It is drawn from the big card image, never blocks a click, and stays inside the stage.
 */
import { memo, useLayoutEffect, useRef } from "react";
import { CardImg } from "./card-img";
import { animate, motionOff, prefersReducedMotion } from "./motion";
import { placePreview, previewWidth } from "./preview-model";
import type { RoomCard } from "./room-model";

export const CardPreview = memo(function CardPreview({
  card,
  instant,
  stage,
  layout,
}: {
  card: RoomCard;
  instant: boolean;
  stage: HTMLElement | null;
  /** Changes whenever the table moves, so the preview follows. */
  layout: unknown;
}) {
  const root = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const entered = useRef(false);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !stage) return;
    const face = stage.querySelector(`.tcard[data-id="${card.id}"] .face`);
    if (!face) {
      el.style.visibility = "hidden";
      return;
    }
    const position = () => {
      const sr = stage.getBoundingClientRect();
      const r = face.getBoundingClientRect();
      const size = { width: sr.width, height: sr.height };
      const place = placePreview(
        { left: r.left - sr.left, top: r.top - sr.top, width: r.width, height: r.height },
        size,
        previewWidth(size),
      );
      el.style.width = `${place.width}px`;
      if (inner.current) inner.current.style.transformOrigin = `${place.originX}% ${place.originY}%`;
      // The stage scrolls in the flat table mode, so the box is placed in its content space.
      el.style.transform = `translate(${place.left + stage.scrollLeft}px, ${place.top + stage.scrollTop}px)`;
      el.style.visibility = "visible";
    };
    position();
    let frame: number | null = null;
    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        position();
      });
    };
    stage.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      stage.removeEventListener("scroll", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [card.id, stage, layout]);

  // A short fade and growth when it opens from nothing. Moving card to card just swaps the picture.
  useLayoutEffect(() => {
    if (entered.current) return;
    entered.current = true;
    if (instant || motionOff() || prefersReducedMotion()) return;
    animate(inner.current, [{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "none" }], {
      duration: 150,
      easing: "ease-out",
    });
  }, [instant]);

  return (
    <div className="pv" ref={root} aria-hidden="true" style={{ visibility: "hidden" }}>
      <div className="pv-card" ref={inner}>
        <CardImg key={card.id} card={card} large />
      </div>
    </div>
  );
});
