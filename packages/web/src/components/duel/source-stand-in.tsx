"use client";

/**
 * The stand-in of a card that leaves a field zone under reduced motion. The card does not travel: it stays on its
 * source zone, in the pose and face it had (the sleeve for a Set card), from the first frame until its own
 * fade-out, which MoveFx and the "Added to hand" showcase play at the start of their own fade-in.
 */
import { forwardRef, type CSSProperties } from "react";
import { cardArtUrl, isDefenseAt } from "./constants";
import type { MovePlan } from "./move-plan";
import styles from "./move-fx.module.css";

/** How much a card on the far side is turned (half a circle) and a card in Defense Position (a quarter). */
export function cardTurn(side: "you" | "opp", defense: boolean): number {
  return (side === "opp" ? 180 : 0) + (defense ? 90 : 0);
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const SourceStandIn = forwardRef<HTMLDivElement, { code: number; faceUp: boolean; sleeve: "deck" | "extra" }>(function SourceStandIn({ code, faceUp, sleeve }, ref) {
  const showFace = code > 0 && faceUp;
  return (
    <div ref={ref} className={styles.ghost} data-stand-in="true" style={{ opacity: 1 } as CSSProperties}>
      <div className={styles.flipper} style={{ transform: `rotateY(${showFace ? 0 : 180}deg)` }}>
        {code > 0 ? (
          <div className={styles.face}>
            <img className={styles.art} src={cardArtUrl(code, "small")} alt="" draggable={false} />
          </div>
        ) : null}
        <div className={styles.back} data-sleeve={sleeve} style={{ transform: `rotateY(${code > 0 ? 180 : 0}deg)` }} />
      </div>
    </div>
  );
});

/** Put a stand-in on the source zone of a plan, at the card size (w x h) of its destination. */
export function placeSourceStandIn(el: HTMLElement, plan: MovePlan, overlay: DOMRect, w: number, h: number): boolean {
  const from = plan.source;
  if (!from) return false;
  const scale = clamp(from.rect.height / h, 0.35, 2.4);
  el.style.left = `${from.rect.left - overlay.left + from.rect.width / 2 - w / 2}px`;
  el.style.top = `${from.rect.top - overlay.top + from.rect.height / 2 - h / 2}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.setProperty("--fx-r", `${Math.max(2, w * 0.05)}px`);
  const defense = plan.event.fromPosition == null ? from.defense : isDefenseAt(plan.event.from?.location, plan.event.fromPosition);
  el.style.transform = `rotate(${cardTurn(from.side, defense)}deg) scale(${scale})`;
  return true;
}
