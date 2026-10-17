"use client";

import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Crown, Search } from "lucide-react";
import type { DuelPromptOption, DuelSeatView } from "@yugidraft/shared/duels";
import {
  cardArtUrl, formatStat, LOCATION_EXTRA, LOCATION_GRAVE, LOCATION_HAND, LOCATION_REMOVED, LOCATION_DMZONE, TYPE_LINK, TYPE_MONSTER, zoneKey,
} from "./constants";
import { duelFontClasses } from "./fonts";
import { masterCard, masterDetailLines, withExact } from "./field";
import { anyLegal, anySelected } from "./field-keys";
import type { InspectTarget } from "./inspector";
import { findMasterCard, masterActionParts, masterActionText, masterNextCost, masterPlace, masterSummonLine, moveKind, surchargeText, useMasterSeats, type MasterPlace } from "./master-place";
import type { HudMasterProps } from "./table/hud-layer";
import styles from "./master-badge.module.css";

/**
 * The Deck Master as a round portrait badge in a player's name plate (concept D, "Portrait badges"). It is the smallest
 * way to show the master: nothing sits on the field at rest. The badge says three things at a glance: whose master it is
 * (the card art), where it is ("In zone" or "On field", the art is an empty well while the card is out), and whether you
 * can act with it now (a gold glow and a small "Ready" tag, never colour alone). A click, Enter, Space or the M key opens a
 * pop-over beside the badge: the card, its facts, where it is, what the next summon costs, the effect, and the legal
 * Summon / Set / Inspect buttons. The pop-over is the only part that may cover the field, and only while it is open.
 *
 * The badge is also the Deck Master Zone of its seat for the flights: a summon leaves from the art (`data-master-source`)
 * and a return lands on it (`data-master-dock`). It is always visible, so both flights start and end on it.
 *
 * Your own badge is a larger emblem with the whole card art. It stands in the free space left of your hand row (a fixed
 * layer measured against the hand, see `measureEmblem`), never over the field at rest; a rival's badge stays in its plate as a
 * small portrait. While the pop-over is open a click shield sits under it: the press that closes it is swallowed, and no
 * hand card or zone below receives it. Presses inside the badge and the pop-over never bubble to the table either.
 *
 * On the multi-seat tables (Tag, 3-way, 4-way: `MasterBadgeSource.apart`) your emblem is "set apart" so it never reads as one more
 * hand card: a wider gap, a thin gold divider with a small vertical "Deck Master" label, a shaded strip on the card with the next
 * summon cost and the place, and the same card size as the hand. The 1v1 emblem keeps its tight layout.
 */

/** Where a table finds the master props of a seat (the same props the old plates took), and how Inspect opens the card. */
export interface MasterBadgeSource {
  forSeat: (seat: number) => HudMasterProps | null;
  onInspect: (target: InspectTarget) => void;
  /** Your emblem is set apart from the hand row (a gap, a divider and a label). The multi-seat tables set it; 1v1 does not. "lift" (Tag) stands the emblem on the name plate when the plate is in the way. */
  apart?: boolean | "lift";
}

export const MasterBadgeContext = createContext<MasterBadgeSource | null>(null);

export type BadgeSide = "you" | "opp";

/** The place words of the badge: a short one for the tag under the art, a long one for the pop-over. */
export function masterPlaceWords(place: MasterPlace, view: DuelSeatView | undefined): { short: string; long: string } {
  if (place === "zone") return { short: "In zone", long: "In the Deck Master Zone" };
  if (place === "field") return { short: "On field", long: "On the field" };
  if (place === "none") return { short: "None", long: "No Deck Master" };
  const code = view?.deckMaster?.card.code;
  const card = view && code != null ? findMasterCard(view, code) : null;
  switch (card?.location) {
    case LOCATION_GRAVE: return { short: "In GY", long: "In the Graveyard" };
    case LOCATION_REMOVED: return { short: "Banished", long: "Banished" };
    case LOCATION_HAND: return { short: "In hand", long: "In your hand" };
    case LOCATION_EXTRA: return { short: "In Extra", long: "In the Extra Deck" };
    default: return { short: "Away", long: "Out of its zone" };
  }
}

/** The Deck Master can do something now: a legal action for it, or a prompt that asks for the card. Yours only. */
export function masterIsReady(master: Pick<HudMasterProps, "view" | "local" | "legalKeys" | "canAct" | "legalActionsFor"> | null | undefined): boolean {
  const view = master?.view;
  if (!master || !view?.deckMaster || !master.local) return false;
  const card = masterCard(view);
  const keys = withExact(card, [zoneKey(view.seat, LOCATION_DMZONE, 0)]);
  return (master.canAct && anyLegal(keys, master.legalKeys)) || (master.canAct && card != null && master.legalActionsFor(card, keys).length > 0);
}

/** A card picture is 59 x 86: the emblem keeps that shape. */
const CARD_RATIO = 59 / 86;
/** The gap between the emblem and the first hand card, and the room kept between it and the name plate. */
const EMBLEM_GAP = 14;
/** The set-apart gap: the label column, the gold divider and some air on both sides. */
const APART_GAPS = [34, 28, 24, 20];
/** Below this gap the label has no room; the divider alone marks the master. */
const APART_LABEL_MIN_GAP = 24;
/** A set-apart emblem keeps a slimmer margin to the name plate than the plain one. */
const APART_PLATE_GAP = 4;
/** A lifted emblem (Tag) stands this far above the name plate, at full card height; the table reserves the band for it. */
export const APART_LIFT_GAP = 6;
/** The label is vertical, so it needs this much card height. */
const APART_LABEL_MIN_H = 66;
const EMBLEM_PLATE_GAP = 8;
/** The smallest emblem that still reads as a portrait; a tighter hand moves the emblem back onto its plate. */
const EMBLEM_MIN_W = 44;
const EMBLEM_FALLBACK_W = 46;
const EMBLEM_FALLBACK_MIN_W = 28;

export interface EmblemBox { left: number; top: number; width: number; height: number; docked: boolean; gap?: number }

function visible(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  return r.width >= 20 && r.height >= 20 ? r : null;
}

/** The name plate that holds the badge slot: the first ancestor that is plate sized. */
function plateOf(slot: HTMLElement | null): DOMRect | null {
  const team = slot?.closest("[data-team-plate]");
  if (team) return team.getBoundingClientRect();
  let el: HTMLElement | null = slot?.parentElement ?? null;
  for (let depth = 0; el && depth < 4; depth += 1, el = el.parentElement) {
    const r = el.getBoundingClientRect();
    if (r.width >= 100 && r.height >= 40) return r;
  }
  return null;
}

/** The whole hand row as one box, even when its cards are only a few pixels wide (a phone). Null: no cards. */
function tinyHandRect(row: HTMLElement | null): DOMRect | null {
  let box: DOMRect | null = null;
  for (const el of Array.from(row?.querySelectorAll<HTMLElement>("[data-hand-card], button[data-zones]") ?? [])) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    box = box ? new DOMRect(Math.min(box.left, r.left), Math.min(box.top, r.top), Math.max(box.right, r.right) - Math.min(box.left, r.left), Math.max(box.bottom, r.bottom) - Math.min(box.top, r.top)) : r;
  }
  return box;
}

/** Does a box come within a few pixels of a control the emblem must not cover? */
function overlapsControl(controls: DOMRect[], x: number, y: number, w: number, h: number): boolean {
  return controls.some((r) => x < r.right + 4 && x + w > r.left - 4 && y < r.bottom + 1 && y + h > r.top - 1);
}

/** The small name box around a badge slot (a holo LP plate on a phone): the first ancestor that is 60 x 30 or more. */
function smallPlateOf(slot: HTMLElement | null): DOMRect | null {
  let el: HTMLElement | null = slot?.parentElement ?? null;
  for (let depth = 0; el && depth < 4; depth += 1, el = el.parentElement) {
    const r = el.getBoundingClientRect();
    if (r.width >= 60 && r.height >= 30) return r;
  }
  return null;
}

/**
 * A phone shrinks the hand to a few pixels per card. A set-apart emblem then stands on free table instead of on its plate:
 * left of the hand (as wide as a hand card when the room allows, never under 28 px), or else under the hand and the name box.
 * `under` is off for Tag, where the strip under the hand is the plate itself. Null: nothing fits, the badge stays on its plate.
 */
function smallHandSpot(hand: DOMRect, slot: HTMLElement | null, vh: number, cardW: number, under: boolean, controls: DOMRect[]): EmblemBox | null {
  const blocked = (x: number, y: number, w: number, h: number) => overlapsControl(controls, x, y, w, h);
  const plate = smallPlateOf(slot);
  const room = Math.floor(hand.left - 8 - 6);
  const width = Math.min(Math.max(EMBLEM_FALLBACK_MIN_W, Math.round(cardW)), room);
  if (width >= EMBLEM_FALLBACK_MIN_W) {
    const height = Math.round(width / CARD_RATIO);
    const left = Math.round(hand.left - 8 - width);
    // Level with the top of the hand, or else standing on a control that sits just under the hand row.
    const tops = [Math.round(hand.top), ...controls.filter((r) => r.left < left + width && r.right > left && r.top > hand.top).map((r) => Math.round(r.top - 1 - height))];
    for (const top of tops) {
      const clearOfPlate = !plate || plate.right + 4 <= left || plate.bottom + 2 <= top || plate.top >= top + height;
      if (top >= hand.top - 8 && top + height <= vh - 8 && clearOfPlate && !blocked(left, top, width, height)) return { left, top, width, height, docked: false };
    }
  }
  if (!under) return null;
  const w = EMBLEM_FALLBACK_MIN_W;
  const h = Math.round(w / CARD_RATIO);
  const spot = { left: Math.round(Math.max(6, plate ? plate.left : hand.left)), top: Math.round(Math.max(hand.bottom, plate?.bottom ?? 0) + 8) };
  return spot.top + h <= vh - 8 && !blocked(spot.left, spot.top, w, h) ? { ...spot, width: w, height: h, docked: false } : null;
}

/**
 * Where your emblem stands, in window pixels. It takes the visible height of your leftmost hand card (the part of the hand that is
 * already clear of the field) and stands that tall just left of it, so field and hand keep their size. A hand that reaches the name
 * plate squeezes the emblem down to EMBLEM_MIN_W; below that the emblem is a small portrait over the plate's badge slot instead.
 * Null: nothing to measure yet.
 */
export function measureEmblem(slot: HTMLElement | null, seat: number, apart: boolean | "lift" = false): EmblemBox | null {
  if (typeof document === "undefined") return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const row = document.querySelector<HTMLElement>(`[data-hand-seat="${seat}"][data-side="you"]`);
  // Table controls the emblem must never cover (they carry data-dm-avoid); a tighter gap may clear them.
  const controls = Array.from(document.querySelectorAll<HTMLElement>("[data-dm-avoid]"), (el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  const onControl = (x: number, y: number, w: number, h: number) => overlapsControl(controls, x, y, w, h);
  let first: { rect: DOMRect; el: HTMLElement } | null = null;
  if (row) {
    for (const el of Array.from(row.querySelectorAll<HTMLElement>("[data-hand-card], button[data-zones]"))) {
      const rect = visible(el);
      if (rect && (!first || rect.left < first.rect.left)) first = { rect, el };
    }
  }
  if (first) {
    const { rect, el } = first;
    const top = Math.max(rect.top, 8);
    const bottom = Math.min(rect.bottom, vh - 8);
    const layoutH = el.offsetHeight > 0 ? el.offsetHeight : rect.height;
    const layoutW = el.offsetWidth > 0 ? el.offsetWidth : rect.width;
    let height = Math.min(bottom - top, layoutH);
    let width = Math.min(Math.round(height * CARD_RATIO), layoutW);
    // A set-apart emblem is exactly a hand card: take its layout box whole instead of rounding it through the ratio.
    if (apart && height >= layoutH) { width = layoutW; height = layoutH; } else height = Math.round(width / CARD_RATIO);
    const plate = plateOf(slot);
    // A set-apart emblem tries the wide gap first and narrows it (never below the label) before it gives up card size.
    let found: { box: EmblemBox; shrink: number } | null = null;
    for (const gap of apart ? APART_GAPS : [EMBLEM_GAP]) {
      const right = rect.left - gap;
      // The room the emblem has: as tall as the hand card, or squeezed beside the plate, or lifted above the plate.
      const options: Array<{ width: number; height: number; bottom: number }> = [{ width, height, bottom }];
      const plateGap = apart ? APART_PLATE_GAP : EMBLEM_PLATE_GAP;
      if (plate && plate.left < right && plate.right + plateGap > right - width && plate.bottom > bottom - height && plate.top < bottom) {
        options.length = 0;
        const squeezed = Math.floor(right - (plate.right + plateGap));
        options.push(apart && squeezed >= width ? { width, height, bottom } : { width: squeezed, height: Math.round(squeezed / CARD_RATIO), bottom });
        if (apart === "lift") {
          // Tag: the plate sits under the hand row, so the emblem stands on it at full card size (the table keeps that band free).
          const liftBottom = plate.top - APART_LIFT_GAP;
          if (liftBottom - height >= 8) options.push({ width, height, bottom: liftBottom });
        } else {
          const lifted = Math.min(height, plate.top - plateGap - top);
          options.push({ width: Math.round(lifted * CARD_RATIO), height: lifted, bottom: plate.top - plateGap });
        }
      }
      const best = options.filter((o) => o.width >= EMBLEM_MIN_W && right - o.width >= 8 && !onControl(right - o.width, o.bottom - o.height, o.width, o.height)).sort((x, y) => y.height - x.height)[0];
      if (!best) continue;
      const candidate = { box: { left: Math.round(right - best.width), top: Math.round(best.bottom - best.height), width: best.width, height: best.height, docked: true, gap }, shrink: height - best.height };
      if (!found || candidate.shrink < found.shrink) found = candidate;
      if (candidate.shrink <= 0) break;
    }
    if (found) return found.box;
  }
  if (apart) {
    const hand = tinyHandRect(row);
    const spot = hand ? smallHandSpot(hand, slot, vh, first?.rect.width ?? EMBLEM_FALLBACK_MIN_W, apart !== "lift", controls) : null;
    if (spot) return spot;
  }
  const s = slot?.getBoundingClientRect();
  if (!s || s.width < 4 || s.height < 4) return null;
  // No wider than the slot, so the emblem never reaches over the plate beside it.
  const width = Math.round(Math.max(EMBLEM_FALLBACK_MIN_W, Math.min(EMBLEM_FALLBACK_W, s.width)));
  const height = Math.round(width / CARD_RATIO);
  return {
    left: Math.round(Math.max(4, Math.min(s.left + s.width / 2 - width / 2, vw - width - 4))),
    top: Math.round(Math.max(4, Math.min(s.top + s.height / 2 - height / 2, vh - height - 4))),
    width, height, docked: false,
  };
}

/** Follows the hand: one frame loop, state only changes when the box moved a few pixels (a hovered card must not shake it). */
function useEmblemBox(slot: { current: HTMLElement | null }, seat: number | undefined, enabled: boolean, apart: boolean | "lift"): EmblemBox | null {
  const [box, setBox] = useState<EmblemBox | null>(null);
  useEffect(() => {
    if (!enabled || seat == null) {
      setBox(null);
      return undefined;
    }
    let frame = 0;
    const tick = () => {
      const next = measureEmblem(slot.current, seat, apart);
      setBox((now) => {
        if (!next || !now) return next ?? null;
        const near = next.docked === now.docked && next.gap === now.gap && Math.abs(next.left - now.left) <= 6 && Math.abs(next.top - now.top) <= 6
          && Math.abs(next.width - now.width) <= 3 && Math.abs(next.height - now.height) <= 4;
        return near ? now : next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [slot, seat, enabled, apart]);
  return box;
}

/** A press or click inside the badge or its pop-over belongs to it alone: the table (a hand card, a zone, a background) never sees it. */
const contain = { onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(), onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(), onMouseDown: (e: { stopPropagation: () => void }) => e.stopPropagation(), onDoubleClick: (e: { stopPropagation: () => void }) => e.stopPropagation() };

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** The seat's badge, read from the table's `MasterBadgeContext`. Nothing without a context, a master or a Domain table. */
export function SeatMasterBadge({ seat, side, shortcut }: { seat: number | undefined; side: BadgeSide; shortcut?: boolean }) {
  const source = useContext(MasterBadgeContext);
  const props = source && seat != null ? source.forSeat(seat) : null;
  if (!source || !props?.view?.deckMaster) return null;
  return <DeckMasterBadge {...props} onInspect={source.onInspect} side={side} shortcut={shortcut ?? props.local} apart={source.apart} />;
}

export function DeckMasterBadge({
  view, local, legalKeys, selectedKeys, canAct, legalActionsFor, title, onChooseAction, onActivate, onInspect, side, shortcut = false, apart = false,
}: Omit<HudMasterProps, "wide" | "showInUse" | "onHoverCard"> & { onInspect: (target: InspectTarget) => void; side: BadgeSide; shortcut?: boolean; apart?: boolean | "lift" }) {
  const seats = useMasterSeats();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLSpanElement>(null);
  const viaKey = useRef(false);
  const popId = useId();
  const master = view?.deckMaster;
  // Your own badge is the large emblem in a fixed layer; a rival's stays in its plate.
  const emblem = side === "you" && local;
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  const box = useEmblemBox(slotRef, view?.seat, emblem, apart);

  const card = view ? masterCard(view) : null;
  const keys = view ? withExact(card, [zoneKey(view.seat, LOCATION_DMZONE, 0)]) : [];
  const legal = anyLegal(keys, legalKeys);
  const selected = anySelected(keys, selectedKeys);
  const actions: DuelPromptOption[] = view && local && canAct ? legalActionsFor(card, keys) : [];
  const ready = local && canAct && (legal || actions.length > 0);
  const place = masterPlace(view, seats);
  const inUse = place === "field" || place === "elsewhere";
  const words = masterPlaceWords(place, view);
  const summonLine = masterSummonLine(view);
  // A prompt that asks for the card (a target, a material, a chain link) takes the badge as the card.
  const pickable = legal && canAct && card != null && onActivate != null;

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);

  // Esc and Tab out of the pop-over close it. A press outside is taken by the click shield under the pop-over (it closes, nothing else).
  useEffect(() => {
    if (!open) return undefined;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [open, close]);

  // The M key opens and closes your own pop-over (the shortcut the old Deck Master drawer had).
  useEffect(() => {
    if (!shortcut) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return;
      if (event.key?.toLowerCase() !== "m") return;
      if (event.target instanceof Element && event.target.closest(EDITABLE)) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      viaKey.current = true;
      setOpen((now) => !now);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortcut]);

  // A table without a master (or a new duel) leaves no pop-over behind.
  useEffect(() => {
    if (!master) setOpen(false);
  }, [master]);

  if (!view || !master) return null;

  const name = master.card.name;
  const openCard = () => {
    close(false);
    onInspect(card ? { type: "card", card } : { type: "info", card: master.card });
  };
  const art = cardArtUrl(master.card.code, emblem ? "full" : "small");
  const label = `${title}: ${name}, ${words.long.toLowerCase()}${ready ? ", ready" : ""}${summonLine ? `, ${summonLine}` : ""}`;

  const wrapProps = {
    className: emblem ? `${styles.wrap} ${styles.emblem}` : styles.wrap,
    "data-side": side,
    "data-local": local ? "true" : "false",
    "data-ready": ready ? "true" : undefined,
    "data-legal": legal && canAct ? "true" : "false",
    "data-open": open ? "true" : undefined,
    "data-in-use": inUse ? "true" : undefined,
    "data-emblem": emblem ? (box?.docked ? "docked" : "plate") : undefined,
    // Set apart only while the emblem stands beside the hand; the small plate fallback keeps the plain badge.
    "data-apart": emblem && apart && box?.docked ? "true" : undefined,
    // A small portrait (a phone): its pills tuck inside the card so they cannot reach over the table.
    "data-tiny": emblem && box && box.width < 40 ? "true" : undefined,
    "data-testid": "dm-badge-wrap",
    "data-badge-seat": view.seat,
  };
  const wrapStyle: CSSProperties | undefined = emblem
    ? box ? ({ left: box.left, top: box.top, width: box.width, height: box.height, ...(apart && box.docked ? { "--dm-gap": `${box.gap}px` } : null) } as CSSProperties) : { visibility: "hidden" }
    : undefined;

  const body = (
    <div ref={wrapRef} {...wrapProps} style={wrapStyle}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.badge}
        data-testid="dm-badge"
        data-badge-seat={view.seat}
        data-selected={selected ? "true" : undefined}
        aria-label={label}
        aria-haspopup={pickable ? undefined : "dialog"}
        aria-expanded={pickable ? undefined : open}
        aria-controls={open ? popId : undefined}
        {...contain}
        onClick={(event) => {
          event.stopPropagation();
          if (pickable) {
            onActivate(keys, card, event.currentTarget);
            return;
          }
          viaKey.current = event.detail === 0;
          setOpen((now) => !now);
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab" && !event.shiftKey && open) {
            const first = popRef.current?.querySelector<HTMLElement>("button:not(:disabled)");
            if (first) {
              event.preventDefault();
              first.focus({ preventScroll: true });
            }
          }
        }}
      >
        {/* The Deck Master Zone of this seat: a summon flies out of the art and a return flies back into it. */}
        <span className={styles.art} data-master-dock={view.seat} data-master-source={view.seat} data-in-use={inUse ? "true" : undefined}>
          {inUse ? <Crown className={styles.well} size={emblem ? 28 : 18} strokeWidth={1.6} aria-hidden /> : <img src={art} alt="" draggable={false} />}
        </span>
        {/* Set apart: the next summon cost on a shaded strip over the card foot, and where the master is. */}
        {emblem && apart && box?.docked ? (
          <span className={styles.strip} data-testid="dm-badge-strip" data-place={place} aria-hidden="true">
            <b data-testid="dm-badge-strip-cost">{surchargeText(masterNextCost(master))}</b>
            <i>{words.short}</i>
          </span>
        ) : null}
      </button>
      <span className={styles.crown} aria-hidden="true"><Crown size={11} strokeWidth={2} /></span>
      {ready ? <span className={styles.ready} data-testid="dm-badge-ready" aria-hidden="true"><i aria-hidden="true" />Ready</span> : null}
      <span className={styles.state} data-testid="dm-badge-state" data-place={place} aria-hidden="true">{words.short}</span>
      {emblem && apart && box?.docked ? (
        /* The gold divider and the vertical label sit in the gap between the card and the first hand card. */
        <span className={styles.divider} data-testid="dm-badge-divider" aria-hidden="true">
          {box.height >= APART_LABEL_MIN_H && (box.gap ?? 0) >= APART_LABEL_MIN_GAP ? <em data-testid="dm-badge-label" style={{ fontSize: Math.min(9, Math.max(7, Math.floor(box.height * 0.075))) }}>Deck Master</em> : null}
        </span>
      ) : null}
      {open ? (
        <MasterPop
          popRef={popRef}
          focusOnOpen={viaKey.current}
          id={popId}
          anchor={buttonRef}
          side={side}
          title={title}
          view={view}
          local={local}
          words={words}
          summonLine={summonLine}
          actions={actions}
          canAct={canAct}
          onChoose={(option) => {
            close(false);
            onChooseAction(option);
          }}
          onInspect={openCard}
          onTabOut={() => close(true)}
          onDismiss={() => close(false)}
        />
      ) : null}
    </div>
  );

  if (!emblem) return body;
  // The slot keeps the badge's place in the plate (the emblem's fallback anchor and the plate it keeps clear of); the emblem is a fixed layer.
  return (
    <>
      <span ref={slotRef} className={styles.slot} data-testid="dm-badge-slot" aria-hidden="true" />
      {host ? createPortal(body, host) : null}
    </>
  );
}

interface PopPlace { left: number; top: number; ready: boolean; flow: "side" | "above" | "below" }

/** Beside the badge when there is room (right, else left), else above or below it. Kept inside the window. */
function usePopPlace(anchor: { current: HTMLElement | null }, popRef: { current: HTMLElement | null }, side: BadgeSide, mounted: boolean): PopPlace {
  const [place, setPlace] = useState<PopPlace>({ left: 0, top: 0, ready: false, flow: "side" });
  useLayoutEffect(() => {
    const run = () => {
      const button = anchor.current;
      const pop = popRef.current;
      if (!button || !pop || !button.isConnected) return;
      const a = button.getBoundingClientRect();
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      const m = 8;
      const gap = 12;
      const maxTop = Math.max(m, window.innerHeight - h - m);
      // Your badge is at the bottom of the screen, so the pop-over grows upward from it; the rival's grows downward.
      const sideTop = Math.max(m, Math.min(side === "you" ? a.bottom - h : a.top, maxTop));
      let next: PopPlace;
      if (a.right + gap + w <= window.innerWidth - m) next = { left: a.right + gap, top: sideTop, ready: true, flow: "side" };
      else if (a.left - gap - w >= m) next = { left: a.left - gap - w, top: sideTop, ready: true, flow: "side" };
      else {
        const left = Math.max(m, Math.min(a.left, window.innerWidth - w - m));
        const above = a.top - gap - h;
        const below = a.bottom + gap;
        const useAbove = side === "you" ? above >= m : below + h > window.innerHeight - m && above >= m;
        next = useAbove ? { left, top: above, ready: true, flow: "above" } : { left, top: Math.min(below, maxTop), ready: true, flow: "below" };
      }
      setPlace((now) => (now.left === next.left && now.top === next.top && now.ready && now.flow === next.flow ? now : next));
    };
    run();
    window.addEventListener("resize", run);
    window.addEventListener("scroll", run, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(run);
    if (popRef.current) observer?.observe(popRef.current);
    return () => {
      window.removeEventListener("resize", run);
      window.removeEventListener("scroll", run, true);
      observer?.disconnect();
    };
  }, [anchor, popRef, side, mounted]);
  return place;
}

function MasterPop({
  popRef, focusOnOpen, id, anchor, side, title, view, local, words, summonLine, actions, canAct, onChoose, onInspect, onTabOut, onDismiss,
}: {
  popRef: { current: HTMLDivElement | null };
  focusOnOpen: boolean;
  id: string;
  anchor: { current: HTMLElement | null };
  side: BadgeSide;
  title: string;
  view: DuelSeatView;
  local: boolean;
  words: { short: string; long: string };
  summonLine: string | null;
  actions: DuelPromptOption[];
  canAct: boolean;
  onChoose: (option: DuelPromptOption) => void;
  onInspect: () => void;
  onTabOut: () => void;
  onDismiss: () => void;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  const place = usePopPlace(anchor, popRef, side, host != null);
  // Keyboard focus must wait for the portal to mount and become visible.
  useEffect(() => {
    if (focusOnOpen && place.ready) popRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [focusOnOpen, place.ready, popRef]);
  const master = view.deckMaster!;
  const card = master.card;
  const lines = masterDetailLines(card);
  const isMonster = ((card.type ?? 0) & TYPE_MONSTER) !== 0;
  const isLink = ((card.type ?? 0) & TYPE_LINK) !== 0;
  const effect = card.description?.trim() ?? "";

  // The 3D room sets its fonts on the room, not on the page body: copy them for the portal.
  const font = useRef<CSSProperties>({});
  if (anchor.current && Object.keys(font.current).length === 0) {
    const computed = getComputedStyle(anchor.current);
    const out: Record<string, string> = {};
    for (const name of ["--sv-font", "--sv-font-num"]) {
      const value = computed.getPropertyValue(name).trim();
      if (value) out[name] = value;
    }
    font.current = out as CSSProperties;
  }

  const moves = actions.filter((option) => moveKind(option) != null);
  const summon = moves.find((option) => moveKind(option) === "Summon");
  const set = moves.find((option) => moveKind(option) === "Set");
  const others = actions.filter((option) => moveKind(option) == null);
  const showMoves = local && (master.inZone || summon != null || set != null);

  const button = (option: DuelPromptOption | undefined, text: string, testId: string, primary: boolean) => {
    const parts = option ? masterActionParts(option, view, true) : null;
    return (
      <button
        key={option?.id ?? text}
        type="button"
        className={styles.act}
        data-primary={primary ? "true" : undefined}
        data-testid={testId}
        disabled={!option || !canAct}
        title={option ? option.label : `${text} is not legal now`}
        aria-label={option ? masterActionText(option, view, false) : `${text} (not legal now)`}
        onClick={() => option && onChoose(option)}
      >
        <span>{text}</span>
        {parts?.cost ? <small>{parts.cost}</small> : null}
      </button>
    );
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== "Tab") return;
    const items = Array.from(popRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    if ((event.shiftKey && at <= 0) || (!event.shiftKey && at === items.length - 1)) {
      event.preventDefault();
      onTabOut();
    }
  };

  if (!host) return null;
  return createPortal(
    <>
    {/* The click shield: the press that closes the pop-over lands here and goes no further, so no hand card or zone under it reacts. */}
    <div
      className={styles.shield}
      data-testid="dm-badge-shield"
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDismiss(); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onDismiss(); }}
    />
    <div
      ref={popRef}
      id={id}
      className={`${styles.pop} ${duelFontClasses}`}
      role="dialog"
      aria-label={`${title} details`}
      data-testid="dm-badge-pop"
      data-master-popover=""
      data-side={side}
      data-flow={place.flow}
      data-local={local ? "true" : "false"}
      style={{ ...font.current, left: place.left, top: place.top, visibility: place.ready ? "visible" : "hidden" }}
      onKeyDown={onKeyDown}
      {...contain}
    >
      <div className={styles.popTop}>
        <img className={styles.popArt} src={cardArtUrl(card.code, "full")} alt={card.name} draggable={false} />
        <div className={styles.popHead}>
          <small className={styles.popKicker}>{title}</small>
          <b className={styles.popName} data-testid="dm-badge-name">{card.name}</b>
          {lines.map((line) => <span key={line} className={styles.popLine}>{line}</span>)}
          {isMonster ? (
            <span className={styles.popStats} data-testid="dm-badge-stats">
              <span><b>{formatStat(card.attack)}</b> ATK</span>
              {isLink ? null : <span><b>{formatStat(card.defense)}</b> DEF</span>}
            </span>
          ) : null}
          <span className={styles.popWhere} data-testid="dm-badge-where">{words.long}</span>
          {summonLine ? <span className={styles.popCost} data-testid="dm-badge-cost">{summonLine}</span> : null}
        </div>
      </div>
      {effect ? <p className={styles.popEffect} data-testid="dm-badge-effect">{effect}</p> : null}
      <div className={styles.popActs}>
        {showMoves ? button(summon, "Summon", "dm-badge-summon", true) : null}
        {showMoves ? button(set, "Set", "dm-badge-set", false) : null}
        {others.map((option) => button(option, masterActionParts(option, view, true).text, "dm-badge-action", false))}
        <button type="button" className={styles.act} data-testid="dm-badge-inspect" onClick={onInspect}>
          <Search size={13} strokeWidth={1.75} aria-hidden />
          <span>Inspect</span>
        </button>
      </div>
    </div>
    </>,
    host,
  );
}
