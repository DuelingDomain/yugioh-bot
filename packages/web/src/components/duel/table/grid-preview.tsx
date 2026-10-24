"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Pin, X } from "lucide-react";
import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";
import { useCardHoverInfo } from "../card-hover-info";
import { cardTextStyle, useCardTextSize } from "../card-text-size";
import { aimPressClaimed, BOARD_SETTLED_EVENT, claimDrawerPress, promptOwnsPress, useAnyPromptId, usePickPromptId } from "../hover-drawer";
import { useIsNarrow } from "../side-panel";
import { isStaleCopy, staleLine } from "../stale-pin";
import { NEGATED_LINE } from "../inspector";
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

/** The chrome the viewer opens panels with: the wide rail and the edge tabs. A drawer that stands over them hides the way to the Log and Settings. */
const CHROME_UI = '[data-testid="table-rail"], [data-edge-tab]';
/** A panel the viewer opened (the rail drawer, an edge drawer). A pinned card must not stand on the panel the viewer is reading. */
const OPEN_PANEL_UI = '[data-testid="table-drawer"][data-open="true"], [data-edge-drawer][data-state="open"]';

function uiBoxes(selector: string): Box[] {
  const out: Box[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) out.push(box(rect));
  }
  return out;
}

/** The seat of the viewer (the hand row that is theirs), or null for a spectator. */
function ownSeat(): string | null {
  return document.querySelector<HTMLElement>('[data-hand-seat][data-side="you"]')?.getAttribute("data-hand-seat") ?? null;
}

/** The fields of the other seats: the drawer covers as little of them as it can (the owner rule: field state stays visible). */
function rivalFieldBoxes(): Box[] {
  const mine = ownSeat();
  const out: Box[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("[data-seat-field]")) {
    if (el.getAttribute("data-seat-field") === mine) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) out.push(box(rect));
  }
  return out;
}

/**
 * The life-point plates and name plates of every seat (`data-lp-seat` is the tally with the name in each format, `data-team-plate` the Tag team plate).
 * The owner rule: the drawer never covers one. A seat that left has no box and counts for nothing.
 */
const PLATE_UI = "[data-lp-seat], [data-team-plate]";
/** The air the drawer keeps between its edge and a plate. */
const PLATE_GAP = 8;
/** The smallest drawer that still reads well when it gives way to a plate: narrower than this, or shorter, the side counts as taken. */
const MIN_FIT_W = 280;
const MIN_FIT_H = 440;
/** A drawer that gives way to a plate counts this much of its size loss as a cost, next to the share of the fields it covers. */
const FIT_LOSS_WEIGHT = 0.5;
/**
 * A side where no fit clears the plates costs this much more: more than a clear gain on the fields, less than hiding the open panel (cost 1) the
 * viewer is reading or the rail that closes it. On a small window (1366x768) the plates cannot all be kept clear, and the panel wins.
 */
const NO_FIT_COST = 0.8;

/** The width the drawer has by itself (its inline fit override off). The override is put back by the caller. */
function naturalWidth(aside: HTMLElement): number {
  const kept = aside.style.getPropertyValue("--pv-w");
  if (kept) aside.style.removeProperty("--pv-w");
  const width = aside.offsetWidth;
  if (kept) aside.style.setProperty("--pv-w", kept);
  return width;
}

/** How far the phase buttons (End Turn, To Battle) that stand over the strip [from, to] reach up from the bottom of the parent; 0 with none. */
function dockClearance(parent: DOMRect, from: number, to: number): number {
  let dockTop = Infinity;
  for (const button of Array.from(document.querySelectorAll<HTMLElement>("[data-dock-action]"))) {
    const rect = button.getBoundingClientRect();
    if (rect.width > 0 && rect.right > from && rect.left < to && rect.bottom > parent.top) dockTop = Math.min(dockTop, rect.top);
  }
  return dockTop < parent.bottom ? Math.max(0, Math.round(parent.bottom - dockTop + 8)) : 0;
}

/** The part of the drawer that is left to place: the whole drawer, or a narrower or a shorter one that clears the plates. */
type Fit = { side: "left" | "right"; width: number; bottom: number; cost: number; fits: boolean };

/**
 * The best drawer for one side: the full drawer when it covers no plate, else the narrower or the shorter one that does not (at least MIN_FIT_W wide
 * and MIN_FIT_H tall), whichever covers less of the fields. With none, the full drawer comes back with `fits` off and NO_FIT_COST added. `top` and
 * `naturalBottom` are the vertical extent the drawer can have (viewport pixels). The cost is the share of the viewer's own field and hand the drawer
 * covers, plus half the share of the rivals' fields, an open panel (the viewer is reading it) or the rail, and its size loss.
 */
function fitSide(side: "left" | "right", parent: DOMRect, natural: number, top: number, naturalBottom: number): Fit {
  const strip = (width: number, bottom: number): Box => (side === "left"
    ? { left: parent.left, right: parent.left + width, top, bottom }
    : { left: parent.right - width, right: parent.right, top, bottom });
  const plates = uiBoxes(PLATE_UI).map((b) => ({ left: b.left - PLATE_GAP, right: b.right + PLATE_GAP, top: b.top - PLATE_GAP, bottom: b.bottom + PLATE_GAP }));
  const hits = (r: Box) => plates.filter((b) => area(b, r) > 0);
  const own = ownBoxes();
  const rivals = rivalFieldBoxes();
  const ownTotal = own.reduce((sum, b) => sum + (b.right - b.left) * (b.bottom - b.top), 0);
  const rivalTotal = rivals.reduce((sum, b) => sum + (b.right - b.left) * (b.bottom - b.top), 0);
  const chrome = uiBoxes(CHROME_UI);
  const panels = uiBoxes(OPEN_PANEL_UI);
  const cost = (r: Box, kept: number) =>
    (ownTotal > 0 ? own.reduce((sum, b) => sum + area(b, r), 0) / ownTotal : 0)
    + 0.5 * (rivalTotal > 0 ? rivals.reduce((sum, b) => sum + area(b, r), 0) / rivalTotal : 0)
    + (panels.some((b) => area(b, r) > 0) ? 1 : 0)
    + (chrome.some((b) => area(b, r) > 0) ? OWN_MARGIN * 2 : 0)
    + (1 - kept) * FIT_LOSS_WEIGHT;
  const full = strip(natural, naturalBottom);
  const blocked = hits(full);
  if (blocked.length === 0) return { side, width: natural, bottom: naturalBottom, cost: cost(full, 1), fits: true };
  const options: Fit[] = [];
  // Narrower: the edge of the drawer stops before the nearest plate on its way.
  let width = natural;
  for (let i = 0; i < 4; i += 1) {
    const inside = hits(strip(width, naturalBottom));
    if (inside.length === 0) break;
    width = Math.min(width, ...inside.map((b) => (side === "left" ? b.left - parent.left : parent.right - b.right)));
  }
  if (width >= MIN_FIT_W && hits(strip(width, naturalBottom)).length === 0) {
    options.push({ side, width, bottom: naturalBottom, cost: cost(strip(width, naturalBottom), width / natural), fits: true });
  }
  // Shorter: the foot of the drawer stops above the nearest plate under it.
  let bottom = naturalBottom;
  for (let i = 0; i < 4; i += 1) {
    const inside = hits(strip(natural, bottom));
    if (inside.length === 0) break;
    bottom = Math.min(bottom, ...inside.map((b) => b.top));
  }
  if (bottom - top >= MIN_FIT_H && hits(strip(natural, bottom)).length === 0) {
    options.push({ side, width: natural, bottom, cost: cost(strip(natural, bottom), (bottom - top) / (naturalBottom - top)), fits: true });
  }
  if (options.length === 0) return { side, width: natural, bottom: naturalBottom, cost: cost(full, 1) + NO_FIT_COST, fits: false };
  return options.reduce((best, o) => (o.cost < best.cost ? o : best));
}

/** The vertical extent a drawer on `side` can have, in viewport pixels: from the header pills down to the phase buttons. */
function drawerExtent(aside: HTMLElement, parent: DOMRect, side: "left" | "right", width: number): { top: number; bottom: number } {
  const topPx = Number.parseFloat(getComputedStyle(aside).getPropertyValue("--pv-top")) || 54;
  const from = side === "left" ? parent.left : parent.right - width;
  return { top: parent.top + topPx, bottom: parent.bottom - dockClearance(parent, from, from + width) };
}

/** The fit of one side for a drawer element, from the layout as it is. */
function fitFor(aside: HTMLElement, side: "left" | "right"): Fit {
  const parent = (aside.offsetParent ?? document.body).getBoundingClientRect();
  const natural = naturalWidth(aside);
  const { top, bottom } = drawerExtent(aside, parent, side, natural);
  return fitSide(side, parent, natural, top, bottom);
}

/**
 * The side the drawer opens on. It never covers the card it shows (the hovered or focused one); then it covers as little as it can of the viewer's own
 * field and hand and of the rivals' fields, and none of the life-point plates (see `fitSide`: it gives way in width or height). In 4-way and Tag your
 * field is at the left, so the drawer tends to open at the right. An open drawer keeps its side unless it must flip.
 */
function chooseSide(aside: HTMLElement, current: "left" | "right", open: boolean, narrow: boolean): "left" | "right" {
  const parent = (aside.offsetParent ?? document.body).getBoundingClientRect();
  const width = naturalWidth(aside);
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
  // A phone drawer is most of the board: the plates cannot be kept clear there, and a prompt tucks it (see below).
  if (narrow) return current;
  const left = fitFor(aside, "left");
  const right = fitFor(aside, "right");
  // The rail and the edge tabs are a small cost, so a tie goes to the side that leaves them reachable and a clear gain still wins.
  if (right.cost + OWN_MARGIN < left.cost) return "right";
  if (left.cost + OWN_MARGIN < right.cost) return "left";
  return open ? current : "left";
}

/** The boxes a pick prompt asks the viewer to click: every legal zone, card or hand slot on the table. */
function legalBoxes(): Box[] {
  const out: Box[] = [];
  for (const el of document.querySelectorAll<HTMLElement>('[data-legal="true"]')) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) out.push(box(rect, el.closest("[data-hand-seat]") ? rect.width * HAND_GROW : 0));
  }
  return out;
}

/**
 * The prompt's own surfaces: the answer panel (chain Pass / Activate, yes / no, position, option list, order and counter grids, the card grid of a deck
 * or Graveyard search, the response strips) and the bars that stand on the board (the pick bar, the full-width tribute dock, the Tag tray, the rival
 * bar of an attack aim).
 */
const PROMPT_UI = "[data-prompt-panel], [data-prompt-surface], [data-opponent-bar]";

function promptBoxes(): Box[] {
  const out: Box[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(PROMPT_UI)) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) out.push(box(rect));
  }
  return out;
}

/** What a pinned drawer must keep clear of while the viewer has a prompt: its panels and bars, and, for a pick on the board, every legal box. */
function obstacleBoxes(picking: boolean): Box[] {
  return picking ? [...legalBoxes(), ...promptBoxes()] : promptBoxes();
}

/**
 * Where a pinned drawer stands while the viewer has a prompt: on a side that covers none of the prompt's boxes (see `obstacleBoxes`). The side it has
 * comes first, then the other one. With both covered it tucks away (`tuck`): the pin stays and comes back when the prompt ends. The check runs on the
 * pointer-taking drawer, so it must not stay on top of a target or a button: the drawer takes the click, not the zone under it.
 */
function pickPlacement(aside: HTMLElement, current: "left" | "right", picking: boolean): { side: "left" | "right"; tuck: boolean } {
  const parent = (aside.offsetParent ?? document.body).getBoundingClientRect();
  const width = naturalWidth(aside);
  const strips = {
    left: { left: parent.left, right: parent.left + width, top: parent.top, bottom: parent.bottom },
    right: { left: parent.right - width, right: parent.right, top: parent.top, bottom: parent.bottom },
  };
  const targets = obstacleBoxes(picking);
  const covered = (strip: Box) => targets.some((target) => area(target, strip) > 0);
  // A side clear of targets still needs enough room to avoid the LP/name plates.
  const available = (side: "left" | "right") => !covered(strips[side]) && fitFor(aside, side).fits;
  if (available(current)) return { side: current, tuck: false };
  const other = current === "left" ? "right" : "left";
  if (available(other)) return { side: other, tuck: false };
  return { side: current, tuck: true };
}

/** How often the drawer looks at the layout of the prompt's boxes while a prompt is open. */
const SAMPLE_MS = 120;

const rounded = (b: Box) => `${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}`;

/**
 * The layout the drawer's place depends on, as text: the zones of the board and the prompt's boxes. Hand slots are left out (they grow under the pointer).
 * The text stays the same while the board stands still and changes while it moves (a zoom, a seat that leaves, a resize).
 */
function layoutSignature(picking: boolean): string {
  const zones: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("[data-zones]")) {
    if (el.closest("[data-hand-seat]")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) zones.push(rounded(box(rect)));
  }
  const prompt: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(picking ? `[data-legal="true"], ${PROMPT_UI}` : PROMPT_UI)) {
    if (el.closest("[data-hand-seat]")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) prompt.push(rounded(box(rect)));
  }
  return `${zones.join("|")}#${prompt.join("|")}`;
}

/**
 * A number that goes up when the layout (see `layoutSignature`) has changed and then stood still for two samples, or when a board-motion source says
 * the board has settled (`BOARD_SETTLED_EVENT`). The drawer looks again where it should stand when the number changes: a Tag nameplate zoom, the 4-way
 * zoom, a wheel zoom and a seat that leaves all move the zones after the drawer chose its side.
 */
function useLayoutSettle(active: boolean, picking: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    let seen = layoutSignature(picking);
    let done = seen;
    let calm = 0;
    const timer = window.setInterval(() => {
      const now = layoutSignature(picking);
      if (now !== seen) {
        seen = now;
        calm = 0;
        return;
      }
      calm += 1;
      if (calm >= 2 && now !== done) {
        done = now;
        setTick((n) => n + 1);
      }
    }, SAMPLE_MS);
    const settled = () => {
      done = seen = layoutSignature(picking);
      calm = 0;
      setTick((n) => n + 1);
    };
    window.addEventListener(BOARD_SETTLED_EVENT, settled);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(BOARD_SETTLED_EVENT, settled);
    };
  }, [active, picking]);
  return tick;
}

/** The width the "Pinned" handle keeps clear around itself. */
const HANDLE_GAP = 8;

/**
 * Where the "Pinned: <name>" handle stands (viewport pixels): in the largest free gap of the header pills row, else under the header, else in a corner.
 * It must not lie on a box the prompt asks the viewer to click, so the first spot that covers none of them wins.
 */
function handleSpot(width: number, height: number, side: "left" | "right", picking: boolean): { left: number; top: number } {
  const view = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  const taken = [...obstacleBoxes(picking), ...ownBoxes(), ...uiBoxes(PLATE_UI)];
  const spots: { left: number; top: number }[] = [];
  const header = document.querySelector<HTMLElement>("[data-testid='hud-top']");
  let under = 8;
  if (header) {
    const bar = header.getBoundingClientRect();
    const pills = Array.from(header.children).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.left - b.left);
    let from = bar.left;
    const gaps: { from: number; to: number }[] = [];
    for (const pill of pills) {
      gaps.push({ from, to: pill.left });
      from = Math.max(from, pill.right);
    }
    gaps.push({ from, to: bar.right });
    for (const gap of gaps.filter((g) => g.to - g.from >= width + HANDLE_GAP * 2).sort((a, b) => (b.to - b.from) - (a.to - a.from))) {
      spots.push({ left: Math.round((gap.from + gap.to - width) / 2), top: Math.round(bar.top + (bar.height - height) / 2) });
    }
    under = Math.round(bar.bottom + 8);
  }
  const edges = side === "left" ? [8, view.right - width - 8] : [view.right - width - 8, 8];
  for (const left of edges) spots.push({ left, top: under });
  for (const left of edges) spots.push({ left, top: Math.round(view.bottom - height - 8) });
  const fits = (spot: { left: number; top: number }) => !taken.some((t) => area(t, { left: spot.left, right: spot.left + width, top: spot.top, bottom: spot.top + height }) > 0)
    && spot.left >= 0 && spot.left + width <= view.right;
  return spots.find(fits) ?? spots[spots.length - 1] ?? { left: 8, top: 8 };
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
export function GridHoverPreview({ card, owner, reducedMotion, pinned = false, held = false, pin = null, extras = [], onClose }: {
  /** A board card, or the card of a prompt row (`DuelCardInfo`: no position, no owner). */
  card: DuelCard | DuelCardInfo | null;
  owner: { name: string; main: string; ink: string } | null;
  reducedMotion: boolean;
  /** `card` is the pinned card: the same drawer, frozen, with a close button. */
  pinned?: boolean;
  /** `card` belongs to an open card action menu: with "Card info on hover: Off" it still shows, so the player reads the card they act on. */
  held?: boolean;
  /** The pinned card while a hover or a prompt row shows another card over it: the "Pinned" handle stays for it. With `pinned`, `card` is the pin. */
  pin?: DuelCard | DuelCardInfo | null;
  /** The extra lines of a pinned board card (equip link, counters, materials): the same ones as the Card drawer. */
  extras?: readonly string[];
  /** The X button was pressed. `byKeyboard`: Enter or Space, so focus should go back to the card (a mouse click would show the card's hover peek again). */
  onClose?: (byKeyboard: boolean) => void;
}) {
  const textSize = useCardTextSize();
  const asideRef = useRef<HTMLElement>(null);
  const hiddenRef = useRef(false);
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
  // An open hover drawer owns the first Esc and the first right click; a pinned drawer owns the right click (its Esc is the HUD's own: hud-layer.tsx).
  // The press is claimed, so the prompt panels let it go and the next press answers. A pinned drawer gives the press to the prompt when the prompt
  // uses it (it answers Pass / No / Cancel, or it asks for a pick): the pin stays then, and the X button is the way to close it.
  // The listeners stay while the drawer is still on screen in its hide delay, so a press then still closes it at once.
  useEffect(() => {
    if (!showable && !open) return;
    const onContext = (event: MouseEvent) => {
      // The attack aim used this right click before (it dropped the aim): one right click does one thing. (The page blocks the browser menu with
      // preventDefault before any of us run, so `defaultPrevented` cannot tell.)
      if (aimPressClaimed(event)) return;
      // A right click inside the open drawer is always for the drawer: it closes the pin. Elsewhere a prompt that uses the right click gets it. A tucked
      // drawer is not on screen, so it takes none.
      const inside = asideRef.current?.contains(event.target as Node) === true;
      if (pinned && showable && !inside && (promptOwnsPress() || hiddenRef.current)) return;
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
  // The drawer never covers the card it shows, and covers as little as it can of the viewer's own field and hand (chooseSide). A pinned card
  // picks its side the same way when the pin opens. A flip while the drawer is closed snaps to the new edge with no slide, so it never crosses the board.
  const [side, setSide] = useState<"left" | "right">("left");
  const openRef = useRef(open);
  openRef.current = open;
  const currentKey = current ? cardIdentity(current) : null;
  const anyId = useAnyPromptId();
  const pickId = usePickPromptId();
  const narrow = useIsNarrow();
  const prompting = anyId != null;
  const holdingPin = pinned && showable != null;
  const pinCard = holdingPin ? showable : pin;
  const [tucked, setTucked] = useState(false);
  const [peek, setPeek] = useState(false);
  const [spot, setSpot] = useState<{ left: number; top: number } | null>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const sideRef = useRef(side);
  sideRef.current = side;
  // The layout changed and stood still (a zoom, a seat that left): the drawer chooses where to stand again.
  const settled = useLayoutSettle(holdingPin, pickId != null);
  // While the viewer has a prompt, the placement below owns the side, so it cannot flip in the same commit.
  const placing = holdingPin && prompting;
  useLayoutEffect(() => {
    const aside = asideRef.current;
    if (!aside || !showable || placing) return;
    const next = chooseSide(aside, side, openRef.current, narrow);
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
  }, [showable, pinned, currentKey, placing, settled]);
  // A prompt of the viewer must not find the pinned drawer on top of its buttons or targets: the drawer takes the click, not the control under it. The
  // prompt's boxes are its answer panels, the bars on the board (pick bar, tribute dock), the card grids of a search and, for a pick on the board, every
  // legal zone, card and hand slot. The drawer takes the side that covers none of them; with both covered it tucks away (the pin stays) and comes back
  // when the prompt ends. On a narrow screen the drawer is most of the board, so it tucks for every prompt. While tucked, a "Pinned" handle shows the
  // pin again for a look (`peek`), and a hover on a target shows that card over the pin (hud-preview.ts).
  useLayoutEffect(() => {
    if (pinCard == null || !prompting) {
      setTucked(false);
      return;
    }
    // A hover shows over the pin: the pin keeps its state and comes back the same way.
    if (!holdingPin) return;
    const aside = asideRef.current;
    if (!aside) return;
    if (narrow) {
      setTucked(true);
      return;
    }
    let frame = 0;
    const place = () => {
      const next = pickPlacement(aside, sideRef.current, pickId != null);
      setTucked(next.tuck);
      if (next.side !== sideRef.current) setSide(next.side);
    };
    place();
    const again = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(place);
    };
    window.addEventListener("resize", again);
    // The legal boxes change while the prompt stays (a toggle pick, a sum): look again.
    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(again);
    observer?.observe(aside.offsetParent ?? document.body, { subtree: true, attributes: true, attributeFilter: ["data-legal"] });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", again);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingPin, pinCard != null, anyId, pickId, narrow, currentKey, settled]);
  // A peek ends with the prompt (or the next one).
  useEffect(() => setPeek(false), [anyId, pickId, currentKey]);
  const hidden = holdingPin && tucked && !peek;
  hiddenRef.current = hidden;
  // The focused element of a tucked drawer (its X button) must not stay in a hidden box: focus goes to the handle.
  useLayoutEffect(() => {
    const aside = asideRef.current;
    if (hidden && aside && aside.contains(document.activeElement)) handleRef.current?.focus({ preventScroll: true });
  }, [hidden]);
  const handleOn = pinCard != null && prompting && tucked;
  const pinName = pinCard ? pinCard.name ?? `Card ${pinCard.code}` : null;
  useLayoutEffect(() => {
    const handle = handleRef.current;
    if (!handleOn || !handle) {
      setSpot(null);
      return;
    }
    const set = () => {
      // The spot is in viewport pixels; the handle is absolute in the layer of the drawer.
      const at = handleSpot(handle.offsetWidth, handle.offsetHeight, sideRef.current, pickId != null);
      const layer = (handle.offsetParent ?? document.body).getBoundingClientRect();
      setSpot({ left: Math.round(at.left - layer.left), top: Math.round(at.top - layer.top) });
    };
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleOn, side, settled, pickId, pinName, peek]);
  // The drawer starts under the header pills that stand over its edge (the turn pill, the clocks): the header sits at a different height in each shell.
  // It ends above the phase buttons (End Turn, To Battle) on a short window, and it gives way to the life-point plates in width or height (fitSide).
  useLayoutEffect(() => {
    const aside = asideRef.current;
    if (!aside || !open) return;
    const set = () => {
      const parent = (aside.offsetParent ?? document.body).getBoundingClientRect();
      const width = naturalWidth(aside);
      const from = side === "left" ? parent.left : parent.right - width;
      const to = from + width;
      let bottom = 0;
      for (const pill of Array.from(document.querySelectorAll<HTMLElement>("[data-testid='hud-top'] > *"))) {
        const box = pill.getBoundingClientRect();
        if (box.width > 0 && box.right > from && box.left < to) bottom = Math.max(bottom, box.bottom);
      }
      if (bottom > 0) aside.style.setProperty("--pv-top", `${Math.max(0, Math.round(bottom - parent.top + 8))}px`);
      else aside.style.removeProperty("--pv-top");
      const extent = drawerExtent(aside, parent, side, width);
      const fit = narrow ? null : fitSide(side, parent, width, extent.top, extent.bottom);
      const footPx = Math.max(0, Math.round(parent.bottom - (fit ? fit.bottom : extent.bottom)));
      if (fit && fit.width < width) aside.style.setProperty("--pv-w", `${Math.floor(fit.width)}px`);
      else aside.style.removeProperty("--pv-w");
      if (footPx > 0) {
        aside.style.setProperty("--pv-bottom", `${footPx}px`);
        aside.style.setProperty("--pv-room", `${Math.max(0, Math.round(parent.height - (extent.top - parent.top) - footPx))}px`);
      } else {
        aside.style.removeProperty("--pv-bottom");
        aside.style.removeProperty("--pv-room");
      }
    };
    set();
    window.addEventListener("resize", set);
    // The dock buttons come and go with the prompt (End Turn shows after a pick) and the plates move with the camera, and no event says so: a slow check keeps the fit right.
    const timer = window.setInterval(set, 300);
    return () => {
      window.removeEventListener("resize", set);
      window.clearInterval(timer);
    };
  }, [open, current, side, narrow]);

  if (!current) return null;

  const lines = cardInspectLines(current);
  // A stale pin (the card left the board) shows the printed card only: its old ATK / DEF and position no longer hold, and it says why.
  // The line is here, not in the callers' extras, so the 3D, phone, 4-way and Tag shells (they pass none) show it too.
  const stale = isStaleCopy(current);
  const staleNote = stale ? staleLine(current as DuelCard) : null;
  const notes = staleNote && !extras.includes(staleNote) ? [staleNote, ...extras] : extras;
  const { facts } = lines;
  const combat = stale ? null : lines.combat;
  const position = combat && "location" in current && current.position != null ? (isDefenseAt(current.location, current.position) ? "Defense Position" : "Attack Position") : null;
  return (
    <>
    <aside
      ref={asideRef}
      className={styles.preview}
      data-testid="hover-preview"
      data-open={open && !hidden ? "true" : "false"}
      data-tucked={hidden ? "true" : undefined}
      data-side={side}
      data-motion={reducedMotion ? "none" : "slide"}
      aria-hidden={open && !hidden ? undefined : "true"}
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
      {notes.length > 0 ? (
        <ul className={styles.previewExtras} data-testid="hover-preview-extras">
          {notes.map((line) =>
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
    {handleOn && pinName != null ? (
      <button
        ref={handleRef}
        type="button"
        className={styles.pinHandle}
        data-testid="hover-preview-handle"
        data-hud-keep=""
        aria-pressed={peek}
        aria-label={peek ? `Hide pinned card ${pinName}` : `Show pinned card ${pinName}`}
        style={spot ? { left: spot.left, top: spot.top } : { visibility: "hidden" }}
        onClick={() => setPeek((on) => !on)}
      >
        <Pin size={12} strokeWidth={1.75} aria-hidden />
        <span>Pinned: {pinName}</span>
      </button>
    ) : null}
    </>
  );
}
