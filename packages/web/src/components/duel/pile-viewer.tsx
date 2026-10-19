"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { DuelCard } from "@yugidraft/shared/duels";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CardBack } from "./card-face";
import { hasCardName, loadDuelCardInfo } from "./card-info";
import {
  cardArtUrl,
  isHiddenCard,
  isMaterialCard,
  LOCATION_EXTRA,
  zoneKey,
} from "./constants";
import { duelFontClasses } from "./fonts";
import { ChainGlyph } from "./chain-glyph";
import type { ChainLinkState } from "./chain-state";
import { pileChainMarks, type PileChainMark } from "./pile-chain-marks";
import { useSkinStyles } from "./skin";
import baseStyles from "./pile-viewer.module.css";
import { UsableGlow } from "./usable-glow";
import { usableGlowToneForPile } from "./usable-glow-model";

export type PileViewerProps = {
  title: string;
  /** Pile contents in engine order (index 0 is the bottom, the last card is the top). Shown newest first. */
  cards: DuelCard[];
  owner: "you" | "opp";
  /** 3 and 4 seat tables: whose pile this is. The header shows the name and the panel edge takes the seat colour. */
  ownerTag?: { name: string; tone: { main: string; ink: string } } | null;
  open: boolean;
  onClose: () => void;
  /** A click on a card that is not legal right now: show it in the inspector. */
  onInspectCard: (card: DuelCard) => void;
  /**
   * The card under the pointer or focus, or null when it leaves: the left drawer inspector follows it, as it does for board
   * cards. The window itself shows no card text; the drawer is the one place for it.
   */
  onHoverCard?: (card: DuelCard | null) => void;
  /** Called instead of onInspectCard when the clicked card is legal in the current prompt. */
  onActivateCard?: (card: DuelCard, anchor: HTMLElement) => void;
  reducedMotion: boolean;
  /** Zone keys legal in the current prompt: those cards glow (in the pile's summoning-circle tone, with a "Use" tag) and activate on click. */
  legalKeys?: Set<string>;
  selectedKeys?: Set<string>;
  /**
   * The chain right now (`useLiveChainLinks`). A card in this pile that a link activated from wears the link's number
   * and chain glyph, like the badge on the field pile, and the detail says "Chain N · activating / resolving".
   * Left out, nothing is marked.
   */
  chainLinks?: readonly ChainLinkState[];
  /**
   * A pick: the engine asks the player to choose some of these cards (the Xyz materials of a detach cost). The window
   * stays the same centred Materials window; a click on a card chooses it instead of inspecting it, and a bar at the foot
   * says how many are needed, with Confirm when more than one is and Cancel when the engine allows it.
   */
  pick?: PileViewerPick;
};

export type PileViewerPick = {
  /** One prompt option id per entry of `cards`, in the same order: the option a click on that card chooses. */
  ids: readonly string[];
  selected: readonly string[];
  /** A short line under each card's name (which Xyz it is under), or null; same order as `ids`. Left out, none. */
  notes?: ReadonlyArray<string | null>;
  /** The line at the foot: how many to choose and how many are chosen. */
  status: string;
  busy: boolean;
  /** Confirm is shown (the engine needs more than one card). A single pick answers on the click. */
  confirm: boolean;
  /** The count rules hold: Confirm is enabled. */
  ready: boolean;
  cancelable: boolean;
  onToggle: (id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

type Entry = { card: DuelCard; key: string; index: number; marks: readonly PileChainMark[]; id?: string };

const NO_MARKS: readonly PileChainMark[] = [];

/**
 * The chain badge of a pile card: the number in a gold medallion with the chain-link chip, as on the field pile.
 * One badge per link; a card two links activated from shows them side by side, lowest on the right.
 */
function ChainMarkBadges({ marks, styles, size }: { marks: readonly PileChainMark[]; styles: Record<string, string>; size: "thumb" | "detail" }) {
  if (marks.length === 0) return null;
  return (
    // Decorative: a button's children are presentational, so the card button's own label says "Chain link N" and the detail line says it too.
    <span className={styles.chainMarks} data-size={size} data-chain-mark={size} aria-hidden="true">
      {[...marks].reverse().map((mark) => (
        <span key={mark.index} className={styles.chainBadge} data-chain-link={mark.index} data-status={mark.status} data-negated={mark.negated ? "true" : "false"}>
          <span className={styles.chainNum}>{mark.index}</span>
          <span className={styles.chainChip}><ChainGlyph /></span>
        </span>
      ))}
    </span>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function cardName(card: DuelCard, looked?: ReadonlyMap<number, string>): string {
  if (isHiddenCard(card) || card.code == null) return "Face-down card";
  return (hasCardName(card) ? card.name : looked?.get(card.code)) ?? card.name ?? `Card ${card.code}`;
}

/** Scrolls the grid itself (no ancestor scrolls) so the card is fully in view, with room above it for its chain badge. */
function scrollGridTo(grid: HTMLElement, card: HTMLElement): void {
  const gridBox = grid.getBoundingClientRect();
  const cardBox = card.getBoundingClientRect();
  const margin = 12;
  const above = cardBox.top - gridBox.top - margin;
  const below = cardBox.bottom - gridBox.bottom + margin;
  if (above < 0) grid.scrollTop += above;
  else if (below > 0) grid.scrollTop += Math.min(below, above);
}

/** Number of cards on the first row of the grid: how far an Up/Down arrow moves focus. */
function columnCount(grid: HTMLElement | null): number {
  if (!grid) return 1;
  const items = grid.querySelectorAll<HTMLElement>("[data-pile-card]");
  if (items.length === 0) return 1;
  const firstTop = items[0].offsetTop;
  let count = 0;
  for (const item of items) {
    if (Math.abs(item.offsetTop - firstTop) > 2) break;
    count += 1;
  }
  return Math.max(1, count);
}

/**
 * A pile (Graveyard, Banished, Extra Deck…) opened as a centred sheet over the board: newest card first,
 * a compact preview of the card under the pointer or focus, and keyboard travel (arrows, Home, End, Esc).
 * Modal while open: the focus stays inside; Esc, the close button and a click on the scrim close it.
 *
 * Its state is its own (never the inspector's), so hovering a board card while it is open cannot replace
 * it. Mount it inside the board box: the scrim covers the board and the panel sits in the middle, on
 * phones too. The panel carries `data-pile-viewer` so hover tooltips keep clear of it.
 */
export function PileViewer({
  title,
  cards,
  owner,
  ownerTag,
  open,
  onClose,
  onInspectCard,
  onHoverCard,
  onActivateCard,
  reducedMotion,
  legalKeys,
  selectedKeys,
  chainLinks,
  pick,
}: PileViewerProps) {
  const styles = useSkinStyles(baseStyles, "pile");
  const headingId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  // `pinnedKey` is the last click or keyboard focus. `hoverKey` only counts while the pointer is on the grid, so a
  // pointer that crosses other cards on its way to the text never replaces the clicked card.
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const hoverCbRef = useRef(onHoverCard);
  hoverCbRef.current = onHoverCard;
  const [lookedNames, setLookedNames] = useState<ReadonlyMap<number, string>>(new Map());

  // The Materials view of an Xyz is this viewer too: its cards sit in the Overlay location.
  const attached = cards.length > 0 && cards.every(isMaterialCard);
  const entries = useMemo<Entry[]>(() => {
    // The marks are keyed by the card's place in `cards`; the list below is reversed, newest first.
    const marks = pileChainMarks(chainLinks ?? [], cards);
    // The materials of an Xyz keep the order they were attached in; a pile shows its top card first.
    const newestFirst = attached ? [...cards] : [...cards].reverse();
    return newestFirst.map((card, index) => {
      const id = pick?.ids[attached ? index : cards.length - 1 - index];
      return {
        card,
        // Two Xyz can hold materials in the same overlay place: a pick keys its cards by the option they answer.
        key: id != null ? `pick:${id}` : `${zoneKey(card.controller, card.location, card.sequence)}:${card.code ?? "x"}`,
        index,
        marks: marks.get(cards.length - 1 - index) ?? NO_MARKS,
        id,
      };
    });
  }, [attached, cards, chainLinks, pick?.ids]);

  const activeKey = (entries.find((entry) => entry.key === hoverKey) ?? entries.find((entry) => entry.key === pinnedKey) ?? entries[0] ?? null)?.key ?? null;
  const tone = usableGlowToneForPile(cards);
  const anyLegal = entries.some((entry) => legalKeys?.has(zoneKey(entry.card.controller, entry.card.location, entry.card.sequence)));

  // A pile card that came without a name gets it by passcode (from the shared lookup cache), so the grid label and aria-label name it too.
  useEffect(() => {
    if (!open) return;
    const codes = [...new Set(entries.flatMap(({ card }) => (!isHiddenCard(card) && card.code != null && !hasCardName(card) ? [card.code] : [])))];
    if (codes.length === 0) return;
    let live = true;
    // The shared lookup cache: a new engine state with the same cards sends no new request.
    void Promise.all(codes.map((code) => loadDuelCardInfo(code))).then((infos) => {
      if (!live) return;
      const names = new Map<number, string>();
      for (const info of infos) if (info && hasCardName(info)) names.set(info.code, info.name);
      setLookedNames(names);
    });
    return () => { live = false; };
  }, [open, entries]);

  // Only the render that opens the viewer decides where it starts (entries are read through a ref, so a chain that starts
  // while the player browses never moves the list). A chain card is the start: it is selected and focused, the grid scrolls
  // to it (the grid only, never the board or the page), and the detail shows it. Without a chain card the top card stays the start.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  // Open: remember where focus was and move it inside. Close: give it back.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const grid = gridRef.current;
    const chainKey = entriesRef.current.find((entry) => entry.marks.length > 0)?.key ?? null;
    const chainCard = chainKey == null ? null : [...(grid?.querySelectorAll<HTMLElement>("[data-pile-card]") ?? [])].find((el) => el.dataset.cardKey === chainKey) ?? null;
    const first = chainCard ?? panel?.querySelector<HTMLElement>("[data-pile-card]") ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus({ preventScroll: true });
    if (chainCard && grid) scrollGridTo(grid, chainCard);
    return () => {
      const back = restoreRef.current;
      restoreRef.current = null;
      if (back && back.isConnected) back.focus({ preventScroll: true });
    };
  }, [open]);

  // The window closing (or a new pile) hands the drawer back: no card of a closed window stays shown.
  useEffect(() => {
    if (!open) return;
    return () => hoverCbRef.current?.(null);
  }, [open]);

  // Esc closes from anywhere (the trap keeps focus inside, but a stray focus must not strand the user).
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  function focusEntry(index: number) {
    const grid = gridRef.current;
    if (!grid) return;
    const items = grid.querySelectorAll<HTMLElement>("[data-pile-card]");
    const target = items[Math.max(0, Math.min(items.length - 1, index))];
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  }

  function onPanelKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    // A pick: 1..9 choose that material, as in the generic card list (PromptCenter and the tray ignore keys inside a dialog).
    if (pick && !event.metaKey && !event.ctrlKey && !event.altKey && !event.nativeEvent.isComposing) {
      const digit = /^[1-9]$/.test(event.key) ? Number(event.key) : /^Numpad[1-9]$/.test(event.key) ? Number(event.key.slice(6)) : null;
      const id = digit != null ? pick.ids[digit - 1] : undefined;
      if (id != null) {
        event.preventDefault();
        if (!event.repeat && !pick.busy) pick.onToggle(id);
        return;
      }
    }
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent != null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function onCardKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const cols = columnCount(gridRef.current);
    let next: number | null = null;
    switch (event.key) {
      case "ArrowRight": next = index + 1; break;
      case "ArrowLeft": next = index - 1; break;
      case "ArrowDown": next = index + cols; break;
      case "ArrowUp": next = index - cols; break;
      case "Home": next = 0; break;
      case "End": next = entries.length - 1; break;
      default: return;
    }
    event.preventDefault();
    if (next < 0 || next >= entries.length) return;
    focusEntry(next);
  }

  function onCardClick(event: ReactMouseEvent<HTMLButtonElement>, key: string, card: DuelCard, legal: boolean, id?: string) {
    // A click always selects the card into the detail (touch has no hover, and some browsers do not focus a tapped button).
    setPinnedKey(key);
    if (pick && id != null) {
      if (!pick.busy) pick.onToggle(id);
      return;
    }
    if (legal && onActivateCard) onActivateCard(card, event.currentTarget);
    else onInspectCard(card);
  }

  // The pointer leaves the grid: the drawer goes back to the tile that still has focus, or closes.
  function onGridLeave() {
    setHoverKey(null);
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>("[data-pile-card]") : null;
    const key = focused && gridRef.current?.contains(focused) ? focused.dataset.cardKey : null;
    onHoverCard?.(entries.find((entry) => entry.key === key)?.card ?? null);
  }

  const total = entries.length;
  return (
    <div className={cn(duelFontClasses, styles.root)} data-reduced={reducedMotion ? "true" : "false"} data-owner={owner} data-has-legal={anyLegal ? "true" : "false"}
      data-toned={ownerTag ? "true" : undefined}
      data-pick={pick ? "true" : undefined}
      data-attached={attached ? "true" : undefined}
      style={{ ...(ownerTag ? { "--seat-main": ownerTag.tone.main, "--seat-ink": ownerTag.tone.ink } : null), "--pv-cols": Math.max(1, Math.min(3, total)) } as CSSProperties}>
      {/* Modal: the scrim takes every click that would reach the board. A pile closes on it; a pick (the engine waits for an answer) only swallows it, and the close button hides the window. */}
      <div className={styles.scrim} onClick={pick ? undefined : onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-pile-viewer
        onKeyDown={onPanelKeyDown}
      >
        <header className={styles.head}>
          <div className={styles.headText}>
            <h2 id={headingId} className={styles.title}>{title}</h2>
            {ownerTag ? (
              <span className={styles.ownerTag} data-testid="pile-owner"><i aria-hidden="true" />{ownerTag.name}</span>
            ) : null}
            <span className={styles.count}>
              <b>{total}</b> {total === 1 ? "card" : "cards"}
              {total > 1 && !attached ? <span className={styles.order}> · newest first</span> : null}
            </span>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label={pick ? "Hide to look at the board" : `Close ${title}`} title={pick ? "Hide to look at the board" : undefined}>
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </header>

        <ul ref={gridRef} className={styles.grid} role="list" aria-label={attached ? title : `${title}, newest first`} onMouseLeave={onGridLeave}>
          {entries.map((entry) => {
            const { card, key, index, marks, id } = entry;
            const hidden = isHiddenCard(card) || card.code == null;
            const zone = zoneKey(card.controller, card.location, card.sequence);
            const legal = pick ? false : legalKeys?.has(zone) ?? false;
            const selected = pick ? id != null && pick.selected.includes(id) : selectedKeys?.has(zone) ?? false;
            const name = cardName(card, lookedNames);
            return (
              <li key={key} className={styles.cell}>
                <button
                  type="button"
                  className={styles.card}
                  data-pile-card
                  data-card-key={key}
                  data-legal={legal ? "true" : "false"}
                  data-selected={selected ? "true" : "false"}
                  data-pick-id={id}
                  data-active={activeKey === key ? "true" : "false"}
                  data-chain-link={marks.length > 0 ? marks[0].index : undefined}
                  aria-label={`${name}, ${index + 1} of ${total}${marks.length > 0 ? `, ${marks.map((mark) => `${mark.ariaLabel} ${mark.phase}`).join(", ")}` : ""}${legal || pick ? ", can be chosen" : ""}`}
                  aria-pressed={selected}
                  onMouseEnter={() => {
                    setHoverKey(key);
                    onHoverCard?.(card);
                  }}
                  onFocus={() => {
                    setPinnedKey(key);
                    setHoverKey(null);
                    onHoverCard?.(card);
                  }}
                  onBlur={() => onHoverCard?.(null)}
                  onKeyDown={(event) => onCardKeyDown(event, index)}
                  onClick={(event) => onCardClick(event, key, card, legal, id)}
                >
                  <span className={styles.art}>
                    {hidden ? (
                      <CardBack kind={card.location === LOCATION_EXTRA ? "extra" : "deck"} className={styles.artBack} />
                    ) : (
                      <img src={cardArtUrl(card.code as number, "small")} alt="" draggable={false} loading="lazy" />
                    )}
                    {selected ? (
                      <>
                        <span className={styles.ring} aria-hidden="true" />
                        <span className={styles.mark} aria-hidden="true">
                          <Check size={11} strokeWidth={2.4} />
                        </span>
                      </>
                    ) : legal ? (
                      <UsableGlow tone={tone} label="Use" still={reducedMotion} />
                    ) : null}
                    <ChainMarkBadges marks={marks} styles={styles} size="thumb" />
                  </span>
                  <span className={styles.name}>{name}</span>
                  {pick?.notes?.[pick.ids.indexOf(id ?? "")] ? <span className={styles.name} data-pick-note>{pick.notes[pick.ids.indexOf(id ?? "")]}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>

        {pick ? (
          <footer className={styles.pickBar} data-testid="pile-pick-bar">
            <span className={styles.pickStatus} data-done={pick.ready ? "true" : "false"} aria-live="polite">{pick.status}</span>
            {pick.cancelable ? (
              <button type="button" className={styles.pickBtn} data-kind="quiet" data-pick-cancel disabled={pick.busy} onClick={pick.onCancel}>
                Cancel
              </button>
            ) : null}
            {pick.confirm ? (
              <button type="button" className={styles.pickBtn} data-kind="primary" data-pick-confirm disabled={!pick.ready || pick.busy} onClick={pick.onConfirm}>
                Confirm
              </button>
            ) : null}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
