"use client";

import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import type { DuelCardInfo } from "@yugidraft/shared/duels";
import { cardArtUrl } from "./constants";
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

export function CardStrip({
  items,
  highlight,
  busy,
  multi,
  label,
  hint = "Hover a card to read it on the left",
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

  // The arrow keys move the highlight: keep that card in view.
  useEffect(() => {
    const list = listRef.current;
    const cell = list?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.parentElement;
    if (!list || !cell) return;
    const next = stripScrollLeft(list, { left: cell.offsetLeft, width: cell.offsetWidth });
    if (next === list.scrollLeft) return;
    const reduced = list.closest('[data-reduced="true"]') != null ||
      (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    list.scrollTo({ left: next, behavior: reduced ? "auto" : "smooth" });
  }, [highlight]);

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
      <ul ref={listRef} className={styles.strip} aria-label={label}>
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
              onClick={() => onPick(index)}
              onDoubleClick={onDouble ? () => onDouble(index) : undefined}
              onMouseEnter={() => {
                onEnter?.(index);
                onInspect?.(item.card);
              }}
              onMouseLeave={onLeave}
              onFocus={() => onInspect?.(item.card)}
            >
              <span className={styles.art} style={{ backgroundImage: `url(${cardArtUrl(item.card.code, "small")})` }}>
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
  );
}
