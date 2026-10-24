"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";
import { useCardHoverInfo } from "../card-hover-info";
import { cardTextStyle, useCardTextSize } from "../card-text-size";
import { CardStatusList } from "../card-status";
import { baseStatsText, cardStatusModel, statusReservePx } from "../card-status-model";
import { claimDrawerPress } from "../hover-drawer";
import { cardArtUrl, cardInspectLines, isDefenseAt, isHiddenCard } from "../constants";
import styles from "./grid-hud.module.css";

/** What makes two hovers the same card: Esc closes the drawer for this key until the pointer leaves the card. */
function cardIdentity(card: DuelCard | DuelCardInfo): string {
  return "location" in card ? `${card.code}|${card.controller}|${card.location}|${card.sequence}` : `${card.code}`;
}

type Box = { left: number; right: number; top: number; bottom: number };

const box = (rect: DOMRect, pad = 0): Box => ({ left: rect.left - pad, right: rect.right + pad, top: rect.top - pad, bottom: rect.bottom + pad });
const area = (a: Box, b: Box) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
/** A hand card grows when it is hovered: its box is padded by this share of its width, so the check also holds after the growth. */
const HAND_GROW = 0.2;
/** One side wins on the viewer's own field only when it covers this share of it less than the other side. */
const OWN_MARGIN = 0.06;

/** The box of the card under the pointer (or the keyboard focus): the deepest hovered card, zone or hand slot. */
function hoveredCardBox(): Box | null {
  const hit = Array.from(document.querySelectorAll<HTMLElement>("[data-card-frame]:hover, [data-hand-card]:hover, [data-zones]:hover")).pop();
  const el = hit ?? document.querySelector<HTMLElement>(":focus-visible");
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return box(rect, el.closest("[data-hand-seat]") ? rect.width * HAND_GROW : 0);
}

/** The viewer's own zones and hand cards: the part of the table the drawer must not hide. Nothing for a spectator. */
function ownBoxes(): Box[] {
  const row = document.querySelector<HTMLElement>('[data-hand-seat][data-side="you"]');
  const seat = row?.getAttribute("data-hand-seat");
  if (!row || seat == null) return [];
  const own = new Set<HTMLElement>(document.querySelectorAll<HTMLElement>(`[data-zones^="${seat}:"]`));
  const hand = new Set<HTMLElement>(row.querySelectorAll<HTMLElement>("[data-hand-card], button[data-zones]"));
  const out: Box[] = [];
  for (const el of own) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) out.push(box(rect, hand.has(el) ? rect.width * HAND_GROW : 0));
  }
  for (const el of hand) {
    if (own.has(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) out.push(box(rect, rect.width * HAND_GROW));
  }
  return out;
}

/**
 * The side the drawer opens on. It never covers the card it shows (the hovered or focused one); then it covers as little as it can of the viewer's own
 * field and hand (in 4-way and Tag your field is at the left, so the drawer opens at the right). An open drawer keeps its side unless it must flip.
 */
function chooseSide(aside: HTMLElement, current: "left" | "right", open: boolean): "left" | "right" {
  const parent = (aside.offsetParent ?? document.body).getBoundingClientRect();
  const width = aside.offsetWidth;
  const strips = {
    left: { left: parent.left, right: parent.left + width, top: parent.top, bottom: parent.bottom },
    right: { left: parent.right - width, right: parent.right, top: parent.top, bottom: parent.bottom },
  };
  const anchor = hoveredCardBox();
  const card = { left: anchor ? area(anchor, strips.left) : 0, right: anchor ? area(anchor, strips.right) : 0 };
  if (card.left > 0 || card.right > 0) {
    if (open && card[current] === 0) return current;
    if (card.left === card.right) return current;
    return card.left < card.right ? "left" : "right";
  }
  const own = ownBoxes();
  if (own.length === 0) return current;
  const total = own.reduce((sum, b) => sum + (b.right - b.left) * (b.bottom - b.top), 0);
  const covered = (strip: Box) => own.reduce((sum, b) => sum + area(b, strip), 0);
  const left = covered(strips.left);
  const right = covered(strips.right);
  if (right + total * OWN_MARGIN < left) return "right";
  if (left + total * OWN_MARGIN < right) return "left";
  return open ? current : "left";
}

/** The drawer lingers this long after the pointer leaves, so a move between two cards does not flicker. */
export const PREVIEW_HIDE_MS = 150;

/**
 * The card inspector of every duel shell (1v1 HUD, Tag, 3-way, 4-way): a drawer that slides out from the left edge of the screen while a card is
 * hovered or focused, and stays after a click (pinned). It lies over the board and never moves it. The card art is the largest part, big enough to
 * read the card text on it; the name, the type line, ATK / DEF, the owner and the effect text stand under it.
 * Hover: the drawer takes no pointer events, so the board under it keeps working and a hover on another card shows that card.
 * Pinned (`pinned`): the drawer stays when the pointer leaves, until `onClose` (the X button, Esc, a press outside, or a click on another card, which pins
 * that one). It then takes the pointer, adds the extra lines of the card (equip link, materials) and the X button. Every card with a status (negated, protections, counters)
 * shows its status list under the type line, hovered or pinned.
 * It starts below the header pills that stand over its edge (`--pv-top`, measured), and it stays above the closed drawer tabs. Face-down cards of a rival show nothing.
 */
export function GridHoverPreview({ card, owner, reducedMotion, pinned = false, held = false, extras = [], onClose }: {
  /** A board card, or the card of a prompt row (`DuelCardInfo`: no position, no owner). */
  card: DuelCard | DuelCardInfo | null;
  owner: { name: string; main: string; ink: string } | null;
  reducedMotion: boolean;
  /** `card` is the pinned card: the same drawer, frozen, with a close button. */
  pinned?: boolean;
  /** `card` belongs to an open card action menu: with "Card info on hover: Off" it still shows, so the player reads the card they act on. */
  held?: boolean;
  /** The extra lines of a pinned board card (equip link, materials): the same ones as the Card drawer. */
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
    && !(hoverOnly && ((hoverInfo === "off" && !held) || dismissed === cardKey)) ? card : null;
  const [open, setOpen] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // An open drawer owns the first Esc (hover only: a pinned drawer closes with the HUD's own Esc) and the first right click (hover and pinned).
  // The press is claimed, so the prompt panels let it go and the next press answers.
  // The listeners stay while the drawer is still on screen in its hide delay, so a press then still closes it at once.
  useEffect(() => {
    if (!showable && !open) return;
    const onContext = (event: MouseEvent) => {
      claimDrawerPress(event);
      event.preventDefault();
      if (!showable) setOpen(false);
      else if (pinned) closeRef.current?.(false);
      else setDismissed(cardKey);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || pinned) return;
      claimDrawerPress(event);
      if (!showable) setOpen(false);
      else setDismissed(cardKey);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("contextmenu", onContext, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("contextmenu", onContext, true);
    };
  }, [showable, open, pinned, cardKey]);
  // The last card stays on screen during the hide delay, so the drawer slides out with its content.
  const [shown, setShown] = useState<DuelCard | DuelCardInfo | null>(null);
  // The layout of the shown card: the drawer keeps it while it slides out, so it does not lose its X button on the way.
  const [shownPinned, setShownPinned] = useState(false);
  useEffect(() => {
    if (showable) {
      setShown(showable);
      setShownPinned(pinned);
      setOpen(true);
      return;
    }
    // A drawer closed by Esc or a right click goes at once, so the next press already belongs to the prompt.
    if (dismissed != null && dismissed === cardKey) {
      setOpen(false);
      return;
    }
    const timer = window.setTimeout(() => setOpen(false), PREVIEW_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [showable, pinned, dismissed, cardKey]);
  const current = showable ?? shown;
  const frozen = showable ? pinned : shownPinned;
  const asideRef = useRef<HTMLElement>(null);
  // The drawer never covers the card it shows, and covers as little as it can of the viewer's own field and hand (chooseSide). A pinned card
  // picks its side the same way when the pin opens. A flip while the drawer is closed snaps to the new edge with no slide, so it never crosses the board.
  const [side, setSide] = useState<"left" | "right">("left");
  const openRef = useRef(open);
  openRef.current = open;
  const currentKey = current ? cardIdentity(current) : null;
  useLayoutEffect(() => {
    const aside = asideRef.current;
    if (!aside || !showable) return;
    const next = chooseSide(aside, side, openRef.current);
    if (next === side) return;
    if (!openRef.current) {
      // Style the closed drawer at its new edge now, with the transition off: the open that follows (in the same render) slides in from the screen edge.
      aside.dataset.side = next;
      aside.style.transition = "none";
      void aside.offsetWidth;
      aside.style.transition = "";
    }
    setSide(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const status = cardStatusModel(current as DuelCard);
  const baseStats = combat ? baseStatsText(current as DuelCard) : null;
  const reserve = statusReservePx(status, baseStats != null);
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
      data-status={reserve > 0 ? "" : undefined}
      style={{ ...cardTextStyle(textSize), ...(owner ? { "--seat-main": owner.main, "--seat-ink": owner.ink } : null), ...(reserve > 0 ? { "--status-px": `${reserve}px`, "--text-chars": current.description?.length ?? 0 } : null) } as CSSProperties}
    >
      <div className={styles.previewHead}>
        {current.code != null ? <img className={styles.previewArt} src={cardArtUrl(current.code, "full")} alt="" draggable={false} /> : null}
        <div className={styles.previewId}>
          <h3>{current.name ?? `Card ${current.code}`}</h3>
          {facts ? <p className={styles.previewType}>{facts}</p> : null}
          {combat ? <p className={styles.previewStats}>{combat}</p> : null}
          {baseStats ? <p className={styles.previewBase} data-testid="hover-preview-base-stats">{baseStats}</p> : null}
          {owner ? (
            <p className={styles.previewOwner}>
              <i aria-hidden="true" />Owner <b>{owner.name}</b>{position ? ` · ${position}` : ""}
            </p>
          ) : position ? <p className={styles.previewOwner}>{position}</p> : null}
        </div>
      </div>
      {/* Full width under the art and the name, also on a short window where the art stands beside the name: the rows do not wrap in a narrow column. */}
      <CardStatusList model={status} />
      {current.description ? (
        <p key={`${current.code}-${current.name}`} className={styles.previewText}>{current.description}</p>
      ) : null}
      {extras.length > 0 ? (
        <ul className={styles.previewExtras} data-testid="hover-preview-extras">
          {extras.map((line) => <li key={line}>{line}</li>)}
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
