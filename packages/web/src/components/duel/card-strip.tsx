"use client";

import { duelFxClock } from "./fx-clock";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
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
 * The scrollTop that brings an item fully into view with `pad` to spare, or the current one when it is already
 * visible: `stripScrollLeft` for the wrapping list of a dense host, which scrolls up and down.
 */
export function stripScrollTop(
  view: { scrollTop: number; clientHeight: number },
  item: { top: number; height: number },
  pad = 12,
): number {
  // A row taller than the list can not fit: show its top.
  if (item.height + 2 * pad > view.clientHeight) return Math.max(0, item.top - pad);
  if (item.top - pad < view.scrollTop) return Math.max(0, item.top - pad);
  const bottom = item.top + item.height + pad;
  if (bottom > view.scrollTop + view.clientHeight) return Math.max(0, bottom - view.clientHeight);
  return view.scrollTop;
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

/** Whether more cards wait above and below, in the wrapping list (a dense host). */
export function stripOverflowY(
  view: { scrollTop: number; clientHeight: number; scrollHeight: number },
  slack = 2,
): { up: boolean; down: boolean } {
  return {
    up: view.scrollTop > slack,
    down: view.scrollTop + view.clientHeight < view.scrollHeight - slack,
  };
}

/** The scrollTop an up or down button moves to: most of a page, so the last row seen stays in view. Clamped to the scrollable range. */
export function stripPageScrollY(
  view: { scrollTop: number; clientHeight: number; scrollHeight: number },
  direction: -1 | 1,
): number {
  const max = Math.max(0, view.scrollHeight - view.clientHeight);
  const step = Math.max(1, Math.round(view.clientHeight * 0.8));
  return Math.min(max, Math.max(0, view.scrollTop + direction * step));
}

/** How many cards sit in the first row, from the top offset of each card in order (the cards that share the first one's row). */
export function cardsPerRow(tops: readonly number[]): number {
  if (tops.length === 0) return 1;
  let count = 0;
  for (const top of tops) {
    if (Math.abs(top - tops[0]) > 2) break;
    count += 1;
  }
  return Math.max(1, count);
}

/** Whether the cards wrap into rows that scroll up and down (a dense host, card-strip.module.css) and not one row that scrolls sideways. */
export function stripWraps(list: HTMLElement): boolean {
  return getComputedStyle(list).flexWrap === "wrap";
}

/** Cards in one row of the strip on screen: 1 when there is none, or when the strip is a single sideways row. For the Up and Down keys. */
export function stripCardsPerRow(): number {
  const list = document.querySelector<HTMLElement>("[data-card-strip]");
  if (!list || !stripWraps(list)) return 1;
  return cardsPerRow(Array.from(list.children, (cell) => (cell as HTMLElement).offsetTop));
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
  offline = false,
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
  /** The duel server is unreachable: the busy caption says Reconnecting instead of Syncing. */
  offline?: boolean;
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
  const [more, setMore] = useState({ prev: false, next: false, up: false, down: false });

  const scrollBehavior = useCallback((list: HTMLElement): ScrollBehavior => {
    const reduced = list.closest('[data-reduced="true"]') != null ||
      (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    return reduced ? "auto" : "smooth";
  }, []);

  // Arrows and edge fades show only on a side that has more cards beyond it.
  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    // One axis scrolls at a time: a wrapping list only up and down, a single row only sideways.
    const next = stripWraps(list)
      ? { prev: false, next: false, ...stripOverflowY(list) }
      : { ...stripOverflow(list), up: false, down: false };
    setMore((current) => (
      current.prev === next.prev && current.next === next.next && current.up === next.up && current.down === next.down ? current : next
    ));
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
      if (r.right < view.left || r.left > view.right || r.bottom < view.top || r.top > view.bottom) return;
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
    const style = getComputedStyle(list);
    // A dense host wraps the cards into rows that scroll up and down (card-strip.module.css): follow on that axis.
    if (stripWraps(list)) {
      const padY = parseFloat(style.scrollPaddingTop) || 12;
      const top = stripScrollTop(list, { top: cell.offsetTop, height: cell.offsetHeight }, padY);
      if (top !== list.scrollTop) list.scrollTo({ top, behavior: scrollBehavior(list) });
      return;
    }
    const pad = parseFloat(style.scrollPaddingLeft) || 12;
    const next = stripScrollLeft(list, { left: cell.offsetLeft, width: cell.offsetWidth }, pad);
    if (next === list.scrollLeft) return;
    list.scrollTo({ left: next, behavior: scrollBehavior(list) });
  }, [highlight, scrollBehavior]);

  function page(direction: -1 | 1) {
    const list = listRef.current;
    if (!list) return;
    if (stripWraps(list)) {
      list.scrollTo({ top: stripPageScrollY(list, direction), behavior: scrollBehavior(list) });
      return;
    }
    list.scrollTo({ left: stripPageScroll(list, direction), behavior: scrollBehavior(list) });
  }

  // A mouse wheel scrolls the strip sideways when it overflows.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const wheel = (event: WheelEvent) => {
      // A wrapping list scrolls up and down by itself.
      if (stripWraps(list)) return;
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
        {busy ? (offline ? "Reconnecting…" : "Syncing…") : <span className={styles.hint}>{hint}</span>}
      </p>
      <div className={styles.frame} data-prev={more.prev} data-next={more.next} data-up={more.up} data-down={more.down}>
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
        {more.up ? (
          <button type="button" className={styles.arrow} data-side="up" tabIndex={-1}
            aria-label="Show earlier cards" onClick={() => page(-1)}>
            <ChevronUp size={20} strokeWidth={2.25} aria-hidden />
          </button>
        ) : null}
        {more.down ? (
          <button type="button" className={styles.arrow} data-side="down" tabIndex={-1}
            aria-label="Show more cards" onClick={() => page(1)}>
            <ChevronDown size={20} strokeWidth={2.25} aria-hidden />
          </button>
        ) : null}
        <ul ref={listRef} className={styles.strip} data-card-strip aria-label={label} data-notes={items.some((item) => item.detail) ? true : undefined} onScroll={() => {
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
                <span className={styles.name} title={item.label}>{item.label}</span>
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
