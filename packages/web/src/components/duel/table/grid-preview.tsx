"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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
 * The places of the pinned panel, in the order tried: the left edge before the right one, the normal art before a small one, and
 * the normal width before a wider one (a long text gets the room by a smaller art or a wider panel, so it does not scroll), then
 * the narrower ones (they only serve to keep clear of the clicked card). Last of all comes a panel with no art: the art gives way
 * before the text scrolls, as in the hover panel.
 */
type Place = { side: "left" | "right"; width: number; art: "normal" | "small" | "none" };
const SIDES = ["left", "right"] as const;
/** The widths of the wide places: the standard ones up to `cap`, then `cap` itself (the panel stays under 60% of the layer, so it never hides the board). */
const wideWidths = (cap: number) => [...[700, 820, 940].filter((width) => width < cap), Math.max(700, cap)];
const widePlaces = (cap: number): Place[] => wideWidths(cap).flatMap((width) => (["normal", "small"] as const).flatMap((art) => SIDES.map((side) => ({ side, width, art }))));
const NARROW_PLACES: ReadonlyArray<Place> = [600, 520, 430].flatMap((width) => SIDES.map((side) => ({ side, width, art: "small" as const })));
const noArtPlaces = (cap: number): Place[] => [...new Set([Math.max(700, cap), 700, 520])].flatMap((width) => SIDES.map((side) => ({ side, width, art: "none" as const })));
const FIRST_PLACE: Place = { side: "left", width: 700, art: "normal" };
/** The widest the panel gets, as a share of the layer: the board stays readable (but never under the standard width). */
const MAX_WIDTH_SHARE = 0.6;
/** The room kept between the panel and the controls at the bottom right. */
const CONTROLS_GAP_PX = 10;
/** How often a pinned panel looks at the clicked card and the controls: a camera move or a prompt can change them with no event. */
const WATCH_MS = 250;
/** Whether a control can be seen and clicked: not collapsed, not invisible. */
function isShown(node: HTMLElement, rect: DOMRect): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
}
/** The top of the bottom right controls (the turn buttons, with the prompt panel that opens above them), or `null`.
 * Only the direct children count, and only those that show: a hidden item still takes room in the column but is no control. */
function controlsTop(): number | null {
  const corner = document.querySelector<HTMLElement>('[data-testid="hud-corner"]');
  if (!corner) return null;
  let top: number | null = null;
  for (const child of Array.from(corner.children) as HTMLElement[]) {
    const rect = child.getBoundingClientRect();
    if (!isShown(child, rect)) continue;
    if (top == null || rect.top < top) top = rect.top;
  }
  return top;
}
/** The gap kept between the panel and the clicked card, and the offsets of the panel from the layer edges (grid-hud.module.css). */
const CLEAR_GAP_PX = 12;
const EDGE_LEFT_PX = 72;
const EDGE_RIGHT_PX = 16;
/** Under this width the panel counts as narrow (the compact layout of the earlier fixes). */
const COMPACT_PX = 560;
const place = (aside: HTMLElement, spot: Place) => {
  aside.setAttribute("data-side", spot.side);
  aside.style.setProperty("--pin-w", `${spot.width}px`);
  if (spot.width < COMPACT_PX) aside.setAttribute("data-narrow", "true"); else aside.removeAttribute("data-narrow");
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
 * scrolling text take it). It stays on the left unless that would touch the clicked card: then it moves to the right, or gets
 * narrower (the widest place that clears the card), so the card stays in view and clickable.
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
  // Where the pinned panel stands: the first of left, right, then both again narrower, that keeps clear of the clicked card.
  const [spot, setSpot] = useState<Place>(FIRST_PLACE);
  const [resizeTick, setResizeTick] = useState(0);
  // What the placement saw last: the clicked card and the controls. A change (a camera move, a prompt that opens) places the panel again.
  const watched = useRef("");
  const watch = useCallback(() => {
    const card = avoid?.isConnected ? avoid.getBoundingClientRect() : null;
    const controls = controlsTop();
    return `${card ? [card.left, card.top, card.width, card.height].map(Math.round).join(",") : ""}|${controls == null ? "" : Math.round(controls)}`;
  }, [avoid]);
  useEffect(() => {
    if (!wide) return;
    const again = () => setResizeTick((tick) => tick + 1);
    const timer = window.setInterval(() => { if (watch() !== watched.current) again(); }, WATCH_MS);
    window.addEventListener("resize", again);
    return () => { window.clearInterval(timer); window.removeEventListener("resize", again); };
  }, [wide, watch]);
  useLayoutEffect(() => {
    const aside = asideRef.current;
    if (!aside || !wide) return;
    const target = avoid?.isConnected ? avoid.getBoundingClientRect() : null;
    const hasTarget = target != null && target.width > 0 && target.height > 0;
    const parent = (aside.offsetParent ?? document.body).getBoundingClientRect();
    const text = textRef.current;
    const cap = Math.round(parent.width * MAX_WIDTH_SHARE);
    // The bottom right controls are the floor of a panel on the right: it grows down to just above them.
    const controls = controlsTop();
    if (controls != null) aside.style.setProperty("--pv-reserve-right", `${Math.max(0, Math.round(parent.bottom - controls + CONTROLS_GAP_PX))}px`);
    else aside.style.removeProperty("--pv-reserve-right");
    // The widest panel that still stands clear of the card on each side, tried right after the standard widths.
    const clear = hasTarget
      ? (["left", "right"] as const).flatMap((side) => {
          const width = Math.floor(side === "left" ? target.left - CLEAR_GAP_PX - (parent.left + EDGE_LEFT_PX) : parent.right - EDGE_RIGHT_PX - (target.right + CLEAR_GAP_PX));
          return width >= 430 && width < Math.max(700, cap) ? (["normal", "small", "none"] as const).map((art) => ({ side, width, art })) : [];
        })
      : [];
    const candidates = [
      ...widePlaces(cap),
      ...clear.filter((candidate) => candidate.art !== "none"),
      ...NARROW_PLACES,
      ...noArtPlaces(cap),
      ...clear.filter((candidate) => candidate.art === "none"),
    ];
    let chosen = candidates[0];
    let best = Infinity;
    for (const candidate of candidates) {
      place(aside, candidate);
      let overlap = 0;
      if (hasTarget) {
        const left = parent.left + aside.offsetLeft;
        const top = parent.top + aside.offsetTop;
        overlap = Math.max(0, Math.min(left + aside.offsetWidth, target.right) - Math.max(left, target.left))
          * Math.max(0, Math.min(top + aside.offsetHeight, target.bottom) - Math.max(top, target.top));
      }
      const hidden = text ? Math.max(0, text.scrollHeight - text.clientHeight - 1) : 0;
      // A place that covers the card always ranks after one that does not; then the one that cuts the least text wins.
      const rank = overlap > 0 ? 1e9 + overlap : hidden;
      if (rank < best) { best = rank; chosen = candidate; }
      if (rank === 0) break;
    }
    place(aside, chosen);
    watched.current = watch();
    setSpot((previous) => (previous.side === chosen.side && previous.width === chosen.width && previous.art === chosen.art ? previous : chosen));
  }, [wide, avoid, current, textSize, resizeTick, watch]);
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
      data-side={wide ? spot.side : undefined}
      data-narrow={wide && spot.width < COMPACT_PX ? "true" : undefined}
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
