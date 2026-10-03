"use client";

import { duelFxClock } from "./fx-clock";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { DuelCardInfo } from "@yugidraft/shared/duels";
import { cardArtUrl } from "./constants";
import { closePickRects, rememberPickRects, type PickEntry } from "./pick-rects";
import styles from "./card-strip.module.css";

/**
 * A horizontal strip of large card images for picking cards in the middle of the board.
 * Hovering or focusing a card shows it in the left inspector (onInspect); the strip itself only
 * shows the art, the short name, the 1/2/3 key number and the selected state.
 */
export interface StripCard {
  id: string;
  card: DuelCardInfo;
  label: string;
  selected: boolean;
  /** Pick order shown on a selected card; a check mark when null. */
  order: number | null;
  /** A short extra line under the name (sum / tribute values). */
  note?: string;
  /** One short line under the name that tells apart cards that look the same (one card, many effects). */
  detail?: string;
  /** Full text of that line, shown as a tooltip. */
  detailTitle?: string;
  /** Where the card is now (a LOCATION_ value): a card picked here that goes to a hand flies out of its place in the strip. */
  location?: number;
}

/**
 * The scrollLeft that brings an item fully into view with `pad` to spare, or the current one when
 * it is already visible. Pure so the keyboard/hover follow can be tested without a layout engine.
 */
export function stripScrollLeft(
  view: { scrollLeft: number; clientWidth: number },
  item: { left: number; width: number },
  pad = 12,
): number {
  if (item.left - pad < view.scrollLeft) return Math.max(0, item.left - pad);
  const right = item.left + item.width + pad;
  if (right > view.scrollLeft + view.clientWidth) return Math.max(0, right - view.clientWidth);
  return view.scrollLeft;
}

/**
 * Whether more cards wait beyond each edge of the strip. When every card fits, both are false: no
 * arrows, no fade, and the row stays centred. `slack` absorbs sub-pixel rounding.
 */
export function stripOverflow(
  view: { scrollLeft: number; clientWidth: number; scrollWidth: number },
  slack = 2,
): { prev: boolean; next: boolean } {
  return {
    prev: view.scrollLeft > slack,
    next: view.scrollLeft + view.clientWidth < view.scrollWidth - slack,
  };
}

/**
 * The scrollLeft an arrow button moves to: most of a page, so the last card seen stays in view as
 * the first card of the next page. Clamped to the scrollable range.
 */
export function stripPageScroll(
  view: { scrollLeft: number; clientWidth: number; scrollWidth: number },
  direction: -1 | 1,
): number {
  const max = Math.max(0, view.scrollWidth - view.clientWidth);
  const step = Math.max(1, Math.round(view.clientWidth * 0.8));
  return Math.min(max, Math.max(0, view.scrollLeft + direction * step));
}

export function CardStrip({
  items,
  highlight,
  busy,
  multi,
  label,
  hint = "Hover to read a card",
  tone,
  onPick,
  onDouble,
  onEnter,
  onLeave,
  onInspect,
}: {
  items: readonly StripCard[];
  highlight: number;
  busy: boolean;
  /** Cards toggle on and off (aria-pressed); otherwise a click answers at once. */
  multi: boolean;
  label: string;
  /** The caption line when idle. */
  hint?: string;
  /** "chain" paints the key numbers gold, as the chain response panel does. */
  tone?: "chain";
  onPick: (index: number) => void;
  onDouble?: (index: number) => void;
  onEnter?: (index: number) => void;
  onLeave?: () => void;
  onInspect?: (card: DuelCardInfo) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState({ prev: false, next: false });

  const scrollBehavior = useCallback((list: HTMLElement): ScrollBehavior => {
    const reduced = list.closest('[data-reduced="true"]') != null ||
      (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    return reduced ? "auto" : "smooth";
  }, []);

  // Arrows and edge fades show only on a side that has more cards beyond it.
  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const next = stripOverflow(list);
    setMore((current) => (current.prev === next.prev && current.next === next.next ? current : next));
  }, []);

  useEffect(() => {
    measure();
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [measure, items.length]);

  // Where the cards are on screen, so a card that is picked and added to a hand starts its flight there.
  const record = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const view = list.getBoundingClientRect();
    const entries: PickEntry[] = [];
    list.querySelectorAll<HTMLElement>("[data-strip-code]").forEach((art) => {
      const r = art.getBoundingClientRect();
      if (r.right < view.left || r.left > view.right) return;
      entries.push({
        code: Number(art.dataset.stripCode) || 0,
        location: Number(art.dataset.stripLoc) || 0,
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      });
    });
    rememberPickRects(entries, duelFxClock.now());
  }, []);

  // After every draw: the strip may have moved, resized or changed its cards.
  useEffect(() => {
    record();
  });

  // When the strip goes away its rects stay for a few seconds (the picked card flies from there).
  useEffect(() => () => closePickRects(duelFxClock.now()), []);

  // The arrow keys move the highlight: keep that card in view, clear of the edge fade.
  useEffect(() => {
    const list = listRef.current;
    const cell = list?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.parentElement;
    if (!list || !cell) return;
    const pad = parseFloat(getComputedStyle(list).scrollPaddingLeft) || 12;
    const next = stripScrollLeft(list, { left: cell.offsetLeft, width: cell.offsetWidth }, pad);
    if (next === list.scrollLeft) return;
    list.scrollTo({ left: next, behavior: scrollBehavior(list) });
  }, [highlight, scrollBehavior]);

  function page(direction: -1 | 1) {
    const list = listRef.current;
    if (!list) return;
    list.scrollTo({ left: stripPageScroll(list, direction), behavior: scrollBehavior(list) });
  }

  // A mouse wheel scrolls the strip sideways when it overflows.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const wheel = (event: WheelEvent) => {
      if (list.scrollWidth <= list.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      list.scrollLeft += event.deltaY;
    };
    list.addEventListener("wheel", wheel, { passive: false });
    return () => list.removeEventListener("wheel", wheel);
  }, []);

  return (
    <div className={styles.wrap} aria-busy={busy} data-tone={tone}>
      <p className={styles.caption} data-busy={busy ? "true" : "false"} role="status">
        {busy ? "Syncing…" : <span className={styles.hint}>{hint}</span>}
      </p>
      <div className={styles.frame} data-prev={more.prev} data-next={more.next}>
        {more.prev ? (
          <button type="button" className={styles.arrow} data-side="prev" tabIndex={-1}
            aria-label="Show earlier cards" onClick={() => page(-1)}>
            <ChevronLeft size={20} strokeWidth={2.25} aria-hidden />
          </button>
        ) : null}
        {more.next ? (
          <button type="button" className={styles.arrow} data-side="next" tabIndex={-1}
            aria-label="Show more cards" onClick={() => page(1)}>
            <ChevronRight size={20} strokeWidth={2.25} aria-hidden />
          </button>
        ) : null}
        <ul ref={listRef} className={styles.strip} aria-label={label} onScroll={() => {
          measure();
          record();
        }}>
          {items.map((item, index) => (
            <li key={item.id} className={styles.cell}>
              <button
                type="button"
                className={styles.card}
                data-index={index}
                data-primary={index === highlight ? true : undefined}
                data-active={index === highlight}
                data-selected={item.selected}
                aria-pressed={multi ? item.selected : undefined}
                aria-label={`${index + 1}. ${item.label}${item.detail ? ` · ${item.detailTitle ?? item.detail}` : ""}${!multi && item.selected ? " (selected)" : ""}`}
                disabled={busy}
                onClick={() => {
                  record();
                  onPick(index);
                }}
                onDoubleClick={onDouble ? () => onDouble(index) : undefined}
                onMouseEnter={() => {
                  onEnter?.(index);
                  onInspect?.(item.card);
                }}
                onMouseLeave={onLeave}
                onFocus={() => onInspect?.(item.card)}
              >
                <span className={styles.art} data-strip-code={item.card.code} data-strip-loc={item.location} style={{ backgroundImage: `url(${cardArtUrl(item.card.code, "small")})` }}>
                  <img
                    src={cardArtUrl(item.card.code, "full")}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                  <span className={styles.num} aria-hidden>{index + 1}</span>
                  {item.selected ? (
                    <span className={styles.mark} aria-hidden>
                      {item.order ?? <Check size={15} strokeWidth={2.75} />}
                    </span>
                  ) : null}
                </span>
                <span className={styles.name}>{item.label}</span>
                {item.note ? <span className={styles.note}>{item.note}</span> : null}
                {item.detail ? (
                  <span className={styles.detail} title={item.detailTitle ?? item.detail}>{item.detail}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
