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
import { findMasterCard, masterActionParts, masterActionText, masterPlace, masterSummonLine, moveKind, useMasterSeats, type MasterPlace } from "./master-place";
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
 */

/** Where a table finds the master props of a seat (the same props the old plates took), and how Inspect opens the card. */
export interface MasterBadgeSource {
  forSeat: (seat: number) => HudMasterProps | null;
  onInspect: (target: InspectTarget) => void;
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

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** The seat's badge, read from the table's `MasterBadgeContext`. Nothing without a context, a master or a Domain table. */
export function SeatMasterBadge({ seat, side, shortcut }: { seat: number | undefined; side: BadgeSide; shortcut?: boolean }) {
  const source = useContext(MasterBadgeContext);
  const props = source && seat != null ? source.forSeat(seat) : null;
  if (!source || !props?.view?.deckMaster) return null;
  return <DeckMasterBadge {...props} onInspect={source.onInspect} side={side} shortcut={shortcut ?? props.local} />;
}

export function DeckMasterBadge({
  view, local, legalKeys, selectedKeys, canAct, legalActionsFor, title, onChooseAction, onActivate, onInspect, side, shortcut = false,
}: Omit<HudMasterProps, "wide" | "showInUse" | "onHoverCard"> & { onInspect: (target: InspectTarget) => void; side: BadgeSide; shortcut?: boolean }) {
  const seats = useMasterSeats();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const viaKey = useRef(false);
  const popId = useId();
  const master = view?.deckMaster;

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

  // Esc, a press outside and Tab out of the pop-over close it. A press on the badge itself is its own toggle.
  useEffect(() => {
    if (!open) return undefined;
    const down = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (popRef.current?.contains(target) || wrapRef.current?.contains(target))) return;
      setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
    };
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

  // Opened by a key: focus moves into the pop-over. Opened by the mouse: focus stays where it was.
  useEffect(() => {
    if (!open || !viaKey.current) return;
    viaKey.current = false;
    popRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [open]);

  if (!view || !master) return null;

  const name = master.card.name;
  const openCard = () => {
    close(false);
    onInspect(card ? { type: "card", card } : { type: "info", card: master.card });
  };
  const art = cardArtUrl(master.card.code, "small");
  const label = `${title}: ${name}, ${words.long.toLowerCase()}${ready ? ", ready" : ""}${summonLine ? `, ${summonLine}` : ""}`;

  return (
    <div ref={wrapRef} className={styles.wrap} data-side={side} data-local={local ? "true" : "false"} data-ready={ready ? "true" : undefined}
      data-legal={legal && canAct ? "true" : "false"} data-open={open ? "true" : undefined} data-in-use={inUse ? "true" : undefined} data-testid="dm-badge-wrap" data-badge-seat={view.seat}>
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
        onClick={(event) => {
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
          {inUse ? <Crown className={styles.well} size={22} strokeWidth={1.6} aria-hidden /> : <img src={art} alt="" draggable={false} />}
        </span>
      </button>
      <span className={styles.crown} aria-hidden="true"><Crown size={11} strokeWidth={2} /></span>
      {ready ? <span className={styles.ready} data-testid="dm-badge-ready" aria-hidden="true"><i aria-hidden="true" />Ready</span> : null}
      <span className={styles.state} data-testid="dm-badge-state" data-place={place} aria-hidden="true">{words.short}</span>
      {open ? (
        <MasterPop
          popRef={popRef}
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
        />
      ) : null}
    </div>
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
  popRef, id, anchor, side, title, view, local, words, summonLine, actions, canAct, onChoose, onInspect, onTabOut,
}: {
  popRef: { current: HTMLDivElement | null };
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
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  const place = usePopPlace(anchor, popRef, side, host != null);
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
    <div
      ref={popRef}
      id={id}
      className={`${styles.pop} ${duelFontClasses}`}
      role="dialog"
      aria-label={`${title} details`}
      data-testid="dm-badge-pop"
      data-side={side}
      data-flow={place.flow}
      data-local={local ? "true" : "false"}
      style={{ ...font.current, left: place.left, top: place.top, visibility: place.ready ? "visible" : "hidden" }}
      onKeyDown={onKeyDown}
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
    </div>,
    host,
  );
}
