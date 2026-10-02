"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { DuelCard } from "@yugidraft/shared/duels";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CardBack } from "./card-face";
import {
  cardArtUrl,
  cardCombatText,
  cardDetailsText,
  cardKindText,
  isHiddenCard,
  LOCATION_EXTRA,
  zoneKey,
} from "./constants";
import { duelFontClasses } from "./fonts";
import styles from "./pile-viewer.module.css";
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
  /** The card under the pointer or focus: the left inspector follows it, as it does for board cards. */
  onHoverCard?: (card: DuelCard) => void;
  /** Called instead of onInspectCard when the clicked card is legal in the current prompt. */
  onActivateCard?: (card: DuelCard, anchor: HTMLElement) => void;
  reducedMotion: boolean;
  /** Zone keys legal in the current prompt: those cards glow (in the pile's summoning-circle tone, with a "Use" tag) and activate on click. */
  legalKeys?: Set<string>;
  selectedKeys?: Set<string>;
};

type Entry = { card: DuelCard; key: string; index: number };

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function cardName(card: DuelCard): string {
  if (isHiddenCard(card) || card.code == null) return "Face-down card";
  return card.name ?? `Card ${card.code}`;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function positionLine(index: number, total: number): string {
  if (total <= 1) return "Only card";
  if (index === 0) return `Top of pile · 1 of ${total}`;
  if (index === total - 1) return `Bottom of pile · ${total} of ${total}`;
  return `${ordinal(index + 1)} from top · ${index + 1} of ${total}`;
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
}: PileViewerProps) {
  const headingId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const entries = useMemo<Entry[]>(() => {
    const newestFirst = [...cards].reverse();
    return newestFirst.map((card, index) => ({
      card,
      key: `${zoneKey(card.controller, card.location, card.sequence)}:${card.code ?? "x"}`,
      index,
    }));
  }, [cards]);

  const preview = entries.find((entry) => entry.key === previewKey) ?? entries[0] ?? null;
  const tone = usableGlowToneForPile(cards);
  const anyLegal = entries.some((entry) => legalKeys?.has(zoneKey(entry.card.controller, entry.card.location, entry.card.sequence)));

  // Open: remember where focus was and move it inside. Close: give it back.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>("[data-pile-card]") ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus({ preventScroll: true });
    return () => {
      const back = restoreRef.current;
      restoreRef.current = null;
      if (back && back.isConnected) back.focus({ preventScroll: true });
    };
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

  function onCardClick(event: ReactMouseEvent<HTMLButtonElement>, card: DuelCard, legal: boolean) {
    if (legal && onActivateCard) onActivateCard(card, event.currentTarget);
    else onInspectCard(card);
  }

  const total = entries.length;
  const previewCard = preview?.card ?? null;
  const previewHidden = previewCard == null || isHiddenCard(previewCard) || previewCard.code == null;
  const previewSleeve = previewCard?.location === LOCATION_EXTRA ? "extra" : "deck";
  const details = previewCard && !previewHidden ? cardDetailsText(previewCard) : "";
  const kind = previewCard && !previewHidden ? cardKindText(previewCard) : "";
  const combat = previewCard && !previewHidden ? cardCombatText(previewCard) : null;
  const text = previewCard && !previewHidden ? previewCard.description?.trim() ?? "" : "";

  return (
    <div className={cn(duelFontClasses, styles.root)} data-reduced={reducedMotion ? "true" : "false"} data-owner={owner} data-has-legal={anyLegal ? "true" : "false"}
      data-toned={ownerTag ? "true" : undefined}
      style={ownerTag ? ({ "--seat-main": ownerTag.tone.main, "--seat-ink": ownerTag.tone.ink } as CSSProperties) : undefined}>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
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
              {total > 1 ? <span className={styles.order}> · newest first</span> : null}
            </span>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label={`Close ${title}`}>
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </header>

        <div className={styles.preview} aria-live="polite">
          {previewCard ? (
            <>
              <div className={styles.previewArt}>
                {previewHidden ? (
                  <CardBack kind={previewSleeve} className={styles.previewBack} />
                ) : (
                  <img src={cardArtUrl(previewCard.code as number, "full")} alt="" draggable={false} />
                )}
              </div>
              <div className={styles.previewBody}>
                <span className={styles.previewPos}>{positionLine(preview?.index ?? 0, total)}</span>
                <h3 className={styles.previewName}>{cardName(previewCard)}</h3>
                {details ? <p className={styles.previewDetails}>{details}</p> : null}
                {kind && kind !== details ? <p className={styles.previewDetails}>{kind}</p> : null}
                {combat ? <p className={styles.previewCombat}>{combat}</p> : null}
                <div className={styles.previewText}>
                  {previewHidden ? <p>Face-down card. Its identity is not public.</p> : text ? <p>{text}</p> : null}
                </div>
              </div>
            </>
          ) : (
            <p className={styles.empty}>This pile is empty.</p>
          )}
        </div>

        <ul ref={gridRef} className={styles.grid} role="list" aria-label={`${title}, newest first`}>
          {entries.map((entry) => {
            const { card, key, index } = entry;
            const hidden = isHiddenCard(card) || card.code == null;
            const zone = zoneKey(card.controller, card.location, card.sequence);
            const legal = legalKeys?.has(zone) ?? false;
            const selected = selectedKeys?.has(zone) ?? false;
            const name = cardName(card);
            return (
              <li key={key} className={styles.cell}>
                <button
                  type="button"
                  className={styles.card}
                  data-pile-card
                  data-legal={legal ? "true" : "false"}
                  data-selected={selected ? "true" : "false"}
                  data-active={preview?.key === key ? "true" : "false"}
                  aria-label={`${name}, ${index + 1} of ${total}${legal ? ", can be chosen" : ""}`}
                  aria-pressed={selected}
                  onMouseEnter={() => {
                    setPreviewKey(key);
                    onHoverCard?.(card);
                  }}
                  onFocus={() => {
                    setPreviewKey(key);
                    onHoverCard?.(card);
                  }}
                  onKeyDown={(event) => onCardKeyDown(event, index)}
                  onClick={(event) => onCardClick(event, card, legal)}
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
                  </span>
                  <span className={styles.name}>{name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}
