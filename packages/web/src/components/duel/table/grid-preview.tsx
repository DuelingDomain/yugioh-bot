"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";
import { cardTextStyle, useCardTextSize } from "../card-text-size";
import { cardArtUrl, cardDetailsText, cardStatsText, isDefenseAt, isHiddenCard } from "../constants";
import styles from "./grid-hud.module.css";

/** The preview lingers this long after the pointer leaves, so a move between two cards does not flicker. */
export const PREVIEW_HIDE_MS = 220;
/** The art is dropped when a long text squeezes it under this height. */
const MIN_ART_PX = 90;

/**
 * The hover preview of the table shells (Tag, 3-way, 4-way): a ~270 px panel that slides out from the left edge while a card is hovered or
 * focused (card, name, type, ATK/DEF, owner, effect text). It takes no pointer events, so it never blocks the board.
 * The text size follows the "Text size" setting. The panel grows taller with it (not wider): the art shrinks first (down
 * to nothing), so the whole effect text shows at normal card lengths. A text that is still longer scrolls inside the panel:
 * only then the text takes the pointer (a wheel scroll), and the pointer on it keeps the panel open.
 * Face-down cards of a rival show nothing.
 * A click on a board card pins the panel (`pinned`): it stays when the pointer leaves, until `onClose` (the X button, Esc,
 * a press outside, or a click on another card, which pins that one). The pinned panel is wide: the art stands beside the
 * text, so the whole effect text shows without a scroll. It takes the pointer, which the hover panel never does.
 */
export function GridHoverPreview({ card, owner, reducedMotion, pinned = false, onClose }: {
  /** A board card, or the card of a prompt row (`DuelCardInfo`: no position, no owner). */
  card: DuelCard | DuelCardInfo | null;
  owner: { name: string; main: string; ink: string } | null;
  reducedMotion: boolean;
  /** `card` is the pinned card: the wide layout with a close button. */
  pinned?: boolean;
  onClose?: () => void;
}) {
  const textSize = useCardTextSize();
  const showable = card != null && !isHiddenCard(card) && card.code != null ? card : null;
  // The last card stays on screen during the hide delay, so the panel slides out with its content.
  const [shown, setShown] = useState<DuelCard | DuelCardInfo | null>(null);
  const [open, setOpen] = useState(false);
  // The layout of the shown card: the panel keeps it while it slides out, so it does not narrow on the way.
  const [shownPinned, setShownPinned] = useState(false);
  // The pointer is on the scrolling text: the panel stays while the viewer reads.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (showable) {
      setShown(showable);
      setShownPinned(pinned);
      setOpen(true);
      return;
    }
    if (held) return;
    const timer = window.setTimeout(() => setOpen(false), PREVIEW_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [showable, held, pinned]);
  const current = showable ?? shown;
  // Does the effect text reach past its area? Then it scrolls and takes the pointer. Measured again when the panel resizes.
  const asideRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [cut, setCut] = useState(false);
  // The art gives way to a long text. When it is squeezed to a sliver it goes away for this card (a new card or size shows it again).
  const artKey = current ? `${current.code}:${textSize}` : "";
  const [squeezed, setSqueezed] = useState("");
  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) { setCut(false); return; }
    const measure = () => {
      setCut(text.scrollHeight - text.clientHeight > 1);
      const art = asideRef.current?.querySelector("img");
      if (art && art.clientHeight > 0 && art.clientHeight < MIN_ART_PX) setSqueezed(artKey);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    if (asideRef.current) observer.observe(asideRef.current);
    return () => observer.disconnect();
  }, [current, textSize, artKey]);
  if (!current) return null;
  const wide = showable ? pinned : shownPinned;

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
      data-pinned={wide ? "true" : undefined}
      data-hud-keep={wide ? "" : undefined}
      aria-label={wide ? "Pinned card" : undefined}
      data-card-text={textSize}
      data-squeezed={squeezed === artKey ? "true" : undefined}
      style={{ ...cardTextStyle(textSize), ...(owner ? { "--seat-main": owner.main, "--seat-ink": owner.ink } : null) } as CSSProperties}
    >
      {current.code != null ? <img className={styles.previewArt} src={cardArtUrl(current.code, "full")} alt="" draggable={false} /> : null}
      <div className={styles.previewBody}>
        <h3>{current.name ?? `Card ${current.code}`}</h3>
        {details ? <p className={styles.previewType}>{details}</p> : null}
        {stats ? <p className={styles.previewStats}>{stats}</p> : null}
        {current.description ? (
          <p
            key={`${current.code}-${current.name}`}
            ref={textRef}
            className={styles.previewText}
            data-overflow={cut ? "true" : undefined}
            onPointerEnter={() => setHeld(true)}
            onPointerLeave={() => setHeld(false)}
          >
            {current.description}
          </p>
        ) : null}
        {owner ? (
          <p className={styles.previewOwner}>
            <i aria-hidden="true" />Owner <b>{owner.name}</b>{position ? ` · ${position}` : ""}
          </p>
        ) : position ? <p className={styles.previewOwner}>{position}</p> : null}
      </div>
      {wide ? (
        <button type="button" className={styles.previewClose} aria-label="Close card preview" data-testid="hover-preview-close" onClick={onClose}>
          <X size={16} strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
    </aside>
  );
}
