"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";
import { cardTextStyle, useCardTextSize } from "../card-text-size";
import { cardArtUrl, cardDetailsText, cardStatsText, isDefenseAt, isHiddenCard } from "../constants";
import styles from "./grid-hud.module.css";
import { ROW_PX, coveredArea, hoverPlaces, measureObstacles, obstaclesKey, pinnedPlaces, type Box, type Place } from "./peek-layout";

/** The preview lingers this long after the pointer leaves, so a move between two cards does not flicker. */
export const PREVIEW_HIDE_MS = 220;
/** The art is dropped when a long text squeezes it under this height. */
const MIN_ART_PX = 90;
/** The widest the panel gets, as a share of the layer: the board stays readable (but never under the standard width). */
const MAX_WIDTH_SHARE = 0.6;
/** How often an open panel looks at the clicked card, the board and the parts it stays clear of: a camera move or a prompt can change them with no event. */
const WATCH_MS = 150;
/** Under this width the panel counts as narrow (the compact layout of the earlier fixes). */
const COMPACT_PX = 560;
/** A hover panel placed narrower than this has its width set (its CSS gives 270 to 284 px). */
const HOVER_MIN_FULL_PX = 270;
const FIRST_PLACE: Place = { side: "left", width: 700, art: "normal", top: 0, maxH: 0 };
const place = (aside: HTMLElement, spot: Place, pinned: boolean, layerTop: number | null) => {
  // `layerTop` is null when the layer cannot be measured (no layout): the CSS places the panel then.
  if (layerTop != null && spot.maxH > 0) {
    aside.style.setProperty("--pv-top", `${Math.round(spot.top - layerTop)}px`);
    aside.style.setProperty("--pv-max-h", `${Math.round(spot.maxH)}px`);
  } else {
    aside.style.removeProperty("--pv-top");
    aside.style.removeProperty("--pv-max-h");
  }
  aside.setAttribute("data-side", spot.side);
  if (!pinned) {
    // The hover panel keeps its own width, unless the room beside the board is less than that.
    if (spot.width < HOVER_MIN_FULL_PX) aside.style.setProperty("--pv-w", `${spot.width}px`); else aside.style.removeProperty("--pv-w");
    return;
  }
  aside.style.setProperty("--pin-w", `${spot.width}px`);
  if (spot.width < COMPACT_PX) aside.setAttribute("data-narrow", "true"); else aside.removeAttribute("data-narrow");
  if (spot.width < ROW_PX) aside.setAttribute("data-stack", "true"); else aside.removeAttribute("data-stack");
  if (spot.art !== "normal") aside.setAttribute("data-art", spot.art); else aside.removeAttribute("data-art");
};

/**
 * The hover preview of the table shells (Tag, 3-way, 4-way): a ~270 px panel that slides out from the left edge while a card is hovered or
 * focused (card, name, type, ATK/DEF, owner, effect text). It takes no pointer events, so it never blocks the board.
 * The text size follows the "Text size" setting. The panel grows taller with it (not wider): the art shrinks first (down
 * to nothing), so the whole effect text shows at normal card lengths. A text that is still longer scrolls inside the panel:
 * only then the text takes the pointer (a wheel scroll), and the pointer on it keeps the panel open.
 * Face-down cards of a rival show nothing.
 * A click on a board card pins the panel (`pinned`): it stays when the pointer leaves, until `onClose` (the X button, Esc,
 * a press outside, or a click on another card, which pins that one). The pinned panel is wide: the art stands beside the
 * text, so the whole effect text shows without a scroll. Its body lets the pointer through to the board (only the X button and a
 * scrolling text take it). Both panels stand in the free side area beside the board (peek-layout.ts measures it): below the chain tower and
 * above the Deck Master plate, clear of the dock, the chain panel and the controls. The pinned one stays on the left unless that would touch
 * the clicked card or the board: then it moves to the right, or gets narrower (a tall panel with the art on top of the text), so the card
 * stays in view and clickable. When no place is free (a narrow screen), the place that covers least wins, and the text scrolls last.
 */
export function GridHoverPreview({ card, owner, reducedMotion, pinned = false, extras = [], avoid = null, onClose }: {
  /** A board card, or the card of a prompt row (`DuelCardInfo`: no position, no owner). */
  card: DuelCard | DuelCardInfo | null;
  owner: { name: string; main: string; ink: string } | null;
  reducedMotion: boolean;
  /** `card` is the pinned card: the wide layout with a close button. */
  pinned?: boolean;
  /** The extra lines of a pinned board card (equip link, counters, materials): the same ones as the Card flyout. */
  extras?: readonly string[];
  /** The element that was clicked to pin the card: the pinned panel moves aside when it would cover it. */
  avoid?: HTMLElement | null;
  /** The X button was pressed. `byKeyboard`: Enter or Space, so focus should go back to the card (a mouse click would show the card's hover peek again). */
  onClose?: (byKeyboard: boolean) => void;
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
  const wide = showable ? pinned : shownPinned;
  // Where the panel stands. Pinned: the first of left, right, wide and narrow places that keeps clear of the clicked card, the board, the chain
  // tower, the Deck Master plates, the dock and the controls. Hover: the left edge, in the first free band (below the chain tower).
  const [spot, setSpot] = useState<Place>(FIRST_PLACE);
  const [resizeTick, setResizeTick] = useState(0);
  // What the placement saw last: the clicked card, the board and the parts kept clear. A change (a camera move, a chain that opens, a prompt)
  // places the panel again.
  const watched = useRef("");
  const watch = useCallback(() => {
    const card = avoid?.isConnected ? avoid.getBoundingClientRect() : null;
    return `${card ? [card.left, card.top, card.width, card.height].map(Math.round).join(",") : ""}|${obstaclesKey(measureObstacles(asideRef.current, avoid))}`;
  }, [avoid]);
  const placing = open && current != null;
  useEffect(() => {
    if (!placing) return;
    const again = () => setResizeTick((tick) => tick + 1);
    const timer = window.setInterval(() => { if (watch() !== watched.current) again(); }, WATCH_MS);
    window.addEventListener("resize", again);
    return () => { window.clearInterval(timer); window.removeEventListener("resize", again); };
  }, [placing, watch]);
  useLayoutEffect(() => {
    const aside = asideRef.current;
    if (!aside || !placing) return;
    const target = wide && avoid?.isConnected ? avoid.getBoundingClientRect() : null;
    const hasTarget = target != null && target.width > 0 && target.height > 0;
    const parent = (aside.offsetParent ?? document.body).getBoundingClientRect();
    const layer: Box = { left: parent.left, top: parent.top, right: parent.right, bottom: parent.bottom };
    const measured = parent.height > 0;
    const obstacles = measureObstacles(aside, wide ? avoid : null);
    const text = textRef.current;
    const cap = Math.round(parent.width * MAX_WIDTH_SHARE);
    const candidates: Place[] = wide
      ? pinnedPlaces(layer, obstacles, hasTarget ? target : null, cap)
      : hoverPlaces(layer, obstacles);
    if (candidates.length === 0) {
      // Nothing to measure (no layout yet): the CSS places the panel.
      place(aside, FIRST_PLACE, wide, null);
      watched.current = watch();
      setSpot((previous) => (previous === FIRST_PLACE ? previous : FIRST_PLACE));
      return;
    }
    let chosen = candidates[0];
    let best: [number, number, number] | null = null;
    for (const candidate of candidates) {
      place(aside, candidate, wide, measured ? parent.top : null);
      const rect: Box = {
        left: parent.left + aside.offsetLeft,
        top: parent.top + aside.offsetTop,
        right: parent.left + aside.offsetLeft + aside.offsetWidth,
        bottom: parent.top + aside.offsetTop + aside.offsetHeight,
      };
      // 1. The clicked card and the parts kept clear (the card first), 2. the board, 3. the effect text that is cut off.
      const hard = (hasTarget ? coveredArea(rect, [{ left: target.left, top: target.top, right: target.right, bottom: target.bottom }]) * 1e3 : 0) + coveredArea(rect, obstacles.keep);
      const board = coveredArea(rect, obstacles.board);
      const hidden = text ? Math.max(0, text.scrollHeight - text.clientHeight - 1) : 0;
      if (best == null || hard < best[0] || (hard === best[0] && (board < best[1] || (board === best[1] && hidden < best[2])))) {
        best = [hard, board, hidden];
        chosen = candidate;
      }
      if (hard === 0 && board === 0 && hidden === 0) break;
    }
    place(aside, chosen, wide, measured ? parent.top : null);
    watched.current = watch();
    setSpot((previous) => (previous.side === chosen.side && previous.width === chosen.width && previous.art === chosen.art && previous.top === chosen.top && previous.maxH === chosen.maxH ? previous : chosen));
  }, [placing, wide, avoid, current, textSize, resizeTick, watch]);
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
      data-pinned={wide ? "true" : undefined}
      data-side={spot.side}
      data-narrow={wide && spot.width < COMPACT_PX ? "true" : undefined}
      data-stack={wide && spot.width < ROW_PX ? "true" : undefined}
      data-art={wide && spot.art !== "normal" ? spot.art : undefined}
      data-hud-keep={wide ? "" : undefined}
      aria-label={wide ? "Pinned card" : undefined}
      data-card-text={textSize}
      data-squeezed={squeezed === artKey ? "true" : undefined}
      style={{ ...cardTextStyle(textSize), ...(wide ? { "--pin-w": `${spot.width}px` } : null), ...(owner ? { "--seat-main": owner.main, "--seat-ink": owner.ink } : null) } as CSSProperties}
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
        {wide && extras.length > 0 ? (
          <ul className={styles.previewExtras} data-testid="hover-preview-extras">
            {extras.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : null}
      </div>
      {wide ? (
        <button type="button" className={styles.previewClose} aria-label={`Close ${current.name ?? `Card ${current.code}`} preview`} data-testid="hover-preview-close" onClick={(event) => onClose?.(event.detail === 0)}>
          <X size={16} strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
    </aside>
  );
}
