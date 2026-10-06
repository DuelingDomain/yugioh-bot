"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";
import { cardTextStyle, useCardTextSize } from "../card-text-size";
import { cardArtUrl, cardDetailsText, cardStatsText, isDefenseAt, isHiddenCard } from "../constants";
import styles from "./grid-hud.module.css";

/** The preview lingers this long after the pointer leaves, so a move between two cards does not flicker. */
export const PREVIEW_HIDE_MS = 220;

/**
 * The hover preview of the table shells (Tag, 3-way, 4-way): a ~270 px panel that slides out from the left edge while a card is hovered or
 * focused (card, name, type, ATK/DEF, owner, effect text). It takes no pointer events, so it never blocks the board.
 * The text size follows the "Card text size" setting. The panel grows taller with it (not wider): the art shrinks first,
 * then a long effect text is cut with a fade and a hint, because the panel takes no pointer events and cannot scroll.
 * Face-down cards of a rival show nothing. A click on a card still opens it fully in the Card flyout.
 */
export function GridHoverPreview({ card, owner, reducedMotion }: {
  /** A board card, or the card of a prompt row (`DuelCardInfo`: no position, no owner). */
  card: DuelCard | DuelCardInfo | null;
  owner: { name: string; main: string; ink: string } | null;
  reducedMotion: boolean;
}) {
  const textSize = useCardTextSize();
  const showable = card != null && !isHiddenCard(card) && card.code != null ? card : null;
  // The last card stays on screen during the hide delay, so the panel slides out with its content.
  const [shown, setShown] = useState<DuelCard | DuelCardInfo | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (showable) {
      setShown(showable);
      setOpen(true);
      return;
    }
    const timer = window.setTimeout(() => setOpen(false), PREVIEW_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [showable]);
  const current = showable ?? shown;
  // Does the effect text reach past its area? Then it shows a fade and the hint. Measured again when the panel resizes.
  const asideRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) { setCut(false); return; }
    const measure = () => setCut(text.scrollHeight - text.clientHeight > 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    if (asideRef.current) observer.observe(asideRef.current);
    return () => observer.disconnect();
  }, [current, textSize]);
  if (!current) return null;

  const stats = cardStatsText(current);
  const details = cardDetailsText(current);
  const position = stats && "location" in current && current.position != null ? (isDefenseAt(current.location, current.position) ? "Defense Position" : "Attack Position") : null;
  return (
    <aside
      ref={asideRef}
      className={styles.preview}
      data-testid="hover-preview"
      data-open={open ? "true" : "false"}
      data-motion={reducedMotion ? "none" : "slide"}
      aria-hidden={open ? undefined : "true"}
      data-card-text={textSize}
      style={{ ...cardTextStyle(textSize), ...(owner ? { "--seat-main": owner.main, "--seat-ink": owner.ink } : null) } as CSSProperties}
    >
      {current.code != null ? <img className={styles.previewArt} src={cardArtUrl(current.code, "full")} alt="" draggable={false} /> : null}
      <h3>{current.name ?? `Card ${current.code}`}</h3>
      {details ? <p className={styles.previewType}>{details}</p> : null}
      {stats ? <p className={styles.previewStats}>{stats}</p> : null}
      {current.description ? <p ref={textRef} className={styles.previewText} data-overflow={cut ? "true" : undefined}>{current.description}</p> : null}
      {current.description && cut ? <p className={styles.previewHint}>Click the card for the full text.</p> : null}
      {owner ? (
        <p className={styles.previewOwner}>
          <i aria-hidden="true" />Owner <b>{owner.name}</b>{position ? ` · ${position}` : ""}
        </p>
      ) : position ? <p className={styles.previewOwner}>{position}</p> : null}
    </aside>
  );
}
