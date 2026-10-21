"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";
import { useCardHoverInfo } from "../card-hover-info";
import { cardTextStyle, useCardTextSize } from "../card-text-size";
import { NEGATED_LINE } from "../inspector";
import { cardArtUrl, cardInspectLines, isDefenseAt, isHiddenCard } from "../constants";
import styles from "./grid-hud.module.css";

/** What makes two hovers the same card: Esc closes the drawer for this key until the pointer leaves the card. */
function cardIdentity(card: DuelCard | DuelCardInfo): string {
  return "location" in card ? `${card.code}|${card.controller}|${card.location}|${card.sequence}` : `${card.code}`;
}

/** The box of the card under the pointer (or the keyboard focus): the deepest hovered card, zone or hand slot. */
function hoveredCardBox(): DOMRect | null {
  const hit = Array.from(document.querySelectorAll<HTMLElement>("[data-card-frame]:hover, [data-hand-card]:hover, [data-zones]:hover")).pop();
  const el = hit ?? document.querySelector<HTMLElement>(":focus-visible");
  return el ? el.getBoundingClientRect() : null;
}

/** The drawer lingers this long after the pointer leaves, so a move between two cards does not flicker. */
export const PREVIEW_HIDE_MS = 150;

/**
 * The card inspector of every duel shell (1v1 HUD, Tag, 3-way, 4-way): a drawer that slides out from the left edge of the screen while a card is
 * hovered or focused, and stays after a click (pinned). It lies over the board and never moves it. The card art is the largest part, big enough to
 * read the card text on it; the name, the type line, ATK / DEF, the owner and the effect text stand under it.
 * Hover: the drawer takes no pointer events, so the board under it keeps working and a hover on another card shows that card.
 * Pinned (`pinned`): the drawer stays when the pointer leaves, until `onClose` (the X button, Esc, a press outside, or a click on another card, which pins
 * that one). It then takes the pointer, adds the extra lines of the card (equip link, counters, materials) and the X button.
 * It starts below the header pills that stand over its edge (`--pv-top`, measured), and it stays above the closed drawer tabs. Face-down cards of a rival show nothing.
 */
export function GridHoverPreview({ card, owner, reducedMotion, pinned = false, extras = [], onClose }: {
  /** A board card, or the card of a prompt row (`DuelCardInfo`: no position, no owner). */
  card: DuelCard | DuelCardInfo | null;
  owner: { name: string; main: string; ink: string } | null;
  reducedMotion: boolean;
  /** `card` is the pinned card: the same drawer, frozen, with a close button. */
  pinned?: boolean;
  /** The extra lines of a pinned board card (equip link, counters, materials): the same ones as the Card drawer. */
  extras?: readonly string[];
  /** The X button was pressed. `byKeyboard`: Enter or Space, so focus should go back to the card (a mouse click would show the card's hover peek again). */
  onClose?: (byKeyboard: boolean) => void;
}) {
  const textSize = useCardTextSize();
  const hoverInfo = useCardHoverInfo();
  // Esc or a right click closes a hover drawer even while the pointer is still on its card; it stays shut until the pointer
  // leaves that card (or moves to another one). `dismissed` holds the key of the card that was closed.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const cardKey = card ? cardIdentity(card) : null;
  useEffect(() => {
    if (dismissed != null && dismissed !== cardKey) setDismissed(null);
  }, [dismissed, cardKey]);
  const hoverOnly = !pinned;
  const showable = card != null && !isHiddenCard(card) && card.code != null
    && !(hoverOnly && (hoverInfo === "off" || dismissed === cardKey)) ? card : null;
  useEffect(() => {
    if (!showable || pinned) return;
    const dismiss = () => setDismissed(cardKey);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) dismiss(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("contextmenu", dismiss, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("contextmenu", dismiss, true);
    };
  }, [showable, pinned, cardKey]);
  // The last card stays on screen during the hide delay, so the drawer slides out with its content.
  const [shown, setShown] = useState<DuelCard | DuelCardInfo | null>(null);
  const [open, setOpen] = useState(false);
  // The layout of the shown card: the drawer keeps it while it slides out, so it does not lose its X button on the way.
  const [shownPinned, setShownPinned] = useState(false);
  useEffect(() => {
    if (showable) {
      setShown(showable);
      setShownPinned(pinned);
      setOpen(true);
      return;
    }
    const timer = window.setTimeout(() => setOpen(false), PREVIEW_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [showable, pinned]);
  const current = showable ?? shown;
  const frozen = showable ? pinned : shownPinned;
  const asideRef = useRef<HTMLElement>(null);
  // The drawer never covers the card it shows: it opens on the left edge, and on the right edge when that card (the one under the
  // pointer, or the focused one) lies in the left drawer's strip. A pinned card keeps the side it opened on.
  const [side, setSide] = useState<"left" | "right">("left");
  const currentKey = current ? cardIdentity(current) : null;
  useLayoutEffect(() => {
    const aside = asideRef.current;
    if (!aside || !showable || pinned) return;
    const anchor = hoveredCardBox();
    if (!anchor) return;
    const parent = (aside.offsetParent ?? document.body).getBoundingClientRect();
    const width = aside.offsetWidth;
    const overlap = (from: number, to: number) => Math.max(0, Math.min(anchor.right, to) - Math.max(anchor.left, from));
    const left = overlap(parent.left, parent.left + width);
    const right = overlap(parent.right - width, parent.right);
    setSide(right < left ? "right" : "left");
  }, [showable, pinned, currentKey]);
  // The drawer starts under the header pills that stand over its edge (the turn pill, the clocks): the header sits at a different height in each shell.
  useLayoutEffect(() => {
    const aside = asideRef.current;
    if (!aside || !open) return;
    const set = () => {
      const parent = (aside.offsetParent ?? document.body).getBoundingClientRect();
      const width = aside.offsetWidth;
      const from = side === "left" ? parent.left : parent.right - width;
      const to = from + width;
      let bottom = 0;
      for (const pill of Array.from(document.querySelectorAll<HTMLElement>("[data-testid='hud-top'] > *"))) {
        const box = pill.getBoundingClientRect();
        if (box.width > 0 && box.right > from && box.left < to) bottom = Math.max(bottom, box.bottom);
      }
      if (bottom > 0) aside.style.setProperty("--pv-top", `${Math.max(0, Math.round(bottom - parent.top + 8))}px`);
      else aside.style.removeProperty("--pv-top");
    };
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, [open, current, side]);

  if (!current) return null;

  const { facts, combat } = cardInspectLines(current);
  const position = combat && "location" in current && current.position != null ? (isDefenseAt(current.location, current.position) ? "Defense Position" : "Attack Position") : null;
  return (
    <aside
      ref={asideRef}
      className={styles.preview}
      data-testid="hover-preview"
      data-open={open ? "true" : "false"}
      data-side={side}
      data-motion={reducedMotion ? "none" : "slide"}
      aria-hidden={open ? undefined : "true"}
      data-pinned={frozen ? "true" : undefined}
      data-hud-keep={frozen ? "" : undefined}
      aria-label={frozen ? "Pinned card" : undefined}
      data-card-text={textSize}
      style={{ ...cardTextStyle(textSize), ...(owner ? { "--seat-main": owner.main, "--seat-ink": owner.ink } : null) } as CSSProperties}
    >
      <div className={styles.previewHead}>
        {current.code != null ? <img className={styles.previewArt} src={cardArtUrl(current.code, "full")} alt="" draggable={false} /> : null}
        <div className={styles.previewId}>
          <h3>{current.name ?? `Card ${current.code}`}</h3>
          {facts ? <p className={styles.previewType}>{facts}</p> : null}
          {combat ? <p className={styles.previewStats}>{combat}</p> : null}
          {owner ? (
            <p className={styles.previewOwner}>
              <i aria-hidden="true" />Owner <b>{owner.name}</b>{position ? ` · ${position}` : ""}
            </p>
          ) : position ? <p className={styles.previewOwner}>{position}</p> : null}
        </div>
      </div>
      {current.description ? (
        <p key={`${current.code}-${current.name}`} className={styles.previewText}>{current.description}</p>
      ) : null}
      {extras.length > 0 ? (
        <ul className={styles.previewExtras} data-testid="hover-preview-extras">
          {extras.map((line) =>
            line === NEGATED_LINE ? (
              <li key={line} className={styles.previewNegated} data-negated="true" data-testid="inspector-negated">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.6" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                {line}
              </li>
            ) : <li key={line}>{line}</li>,
          )}
        </ul>
      ) : null}
      {frozen ? (
        <button type="button" className={styles.previewClose} aria-label={`Close ${current.name ?? `Card ${current.code}`} preview`} data-testid="hover-preview-close" onClick={(event) => onClose?.(event.detail === 0)}>
          <X size={16} strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
    </aside>
  );
}
