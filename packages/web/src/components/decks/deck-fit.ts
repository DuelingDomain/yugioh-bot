"use client";

import { useEffect, useState } from "react";

/** A card is 421 by 614; a tile keeps that shape. */
export const CARD_RATIO = 614 / 421;
/** Gap between tiles, in px. The editor's CSS reads the same value from `--fit-gap`. */
export const FIT_GAP = 5;
const MIN_COLS = 10;
const MAX_COLS = 20;
const MAX_TILE = 150;
/**
 * A full deck is reserved in every section, so tiles keep their size while the player adds cards.
 * A section only claims more rows than this when it holds more cards than the rules allow.
 */
const MAIN_RESERVE = 60;
const EXTRA_RESERVE = 15;
const SIDE_RESERVE = 15;

export interface DeckFitInput {
  /** Width of the deck pane without padding. */
  width: number;
  /** Height of the deck pane without the space its other content takes (padding, bars, headers). */
  free: number;
  main: number;
  extra: number;
  side: number;
  /** The Deck Master row takes one tile row. */
  master: boolean;
  /** False when the format has no Side Deck (Domain): the Side section keeps only its header. */
  sideUsed: boolean;
}

export interface DeckFit {
  cols: number;
  /** Tile width in px. */
  tile: number;
  rows: { main: number; extra: number; side: number };
}

/**
 * Picks the column count and tile size that show the whole deck in the free height and width.
 * More columns make narrower tiles but fewer rows, so the best count depends on the pane's shape.
 */
export function fitDeckLayout(input: DeckFitInput): DeckFit {
  let best: DeckFit | null = null;
  for (let cols = MIN_COLS; cols <= MAX_COLS; cols += 1) {
    const rows = {
      main: Math.ceil(Math.max(input.main, MAIN_RESERVE) / cols),
      extra: Math.ceil(Math.max(input.extra, EXTRA_RESERVE) / cols),
      side: input.sideUsed ? Math.ceil(Math.max(input.side, SIDE_RESERVE) / cols) : 0,
    };
    const sections = [rows.main, rows.extra, rows.side].filter((count) => count > 0);
    const tileRows = sections.reduce((sum, count) => sum + count, 0) + (input.master ? 1 : 0);
    const innerGaps = sections.reduce((sum, count) => sum + (count - 1) * FIT_GAP, 0);
    const byWidth = (input.width - (cols - 1) * FIT_GAP) / cols;
    const byHeight = (input.free - innerGaps) / tileRows / CARD_RATIO;
    const tile = Math.floor(Math.max(0, Math.min(byWidth, byHeight, MAX_TILE)));
    if (!best || tile > best.tile) best = { cols, tile, rows };
  }
  return best!;
}

/** Counts that decide how many rows each section holds. */
export interface DeckFitCounts {
  main: number;
  extra: number;
  side: number;
  master: boolean;
  sideUsed: boolean;
}

/**
 * Sizes the deck pane's tiles so Deck Master, Main, Extra and Side all show without scrolling.
 * Put the returned ref on the pane. The pane sits in the tree later than the hook (the editor shows a loading state first), so it is a callback ref.
 *
 * It writes `--fit-*` custom properties and `data-fit` on the element, which `editor.module.css` reads. Nothing is written
 * while `enabled` is false (the phone layout), when the pane has no size yet, or when there is no room left for cards.
 * Everything that is not a tile area is measured, so notices, banners and the test hand take their space from the tiles.
 * Elements marked `data-fit-area` are the tile areas.
 */
export function useDeckFit(counts: DeckFitCounts, enabled: boolean) {
  const [el, ref] = useState<HTMLElement | null>(null);
  const { main, extra, side, master, sideUsed } = counts;
  useEffect(() => {
    if (!el) return;
    const clear = () => {
      el.removeAttribute("data-fit");
      for (const name of ["cols", "tw", "gap", "rows-main", "rows-extra", "rows-side"]) el.style.removeProperty(`--fit-${name}`);
    };
    if (!enabled) {
      clear();
      return;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const style = getComputedStyle(el);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const width = el.clientWidth - padX;
      const last = el.lastElementChild;
      if (width <= 0 || el.clientHeight <= 0 || !last) return;
      const top = el.getBoundingClientRect().top;
      // Everything the pane holds, tile areas included, then without the tile areas: what is left is the fixed part.
      const content = last.getBoundingClientRect().bottom - top + el.scrollTop;
      let areas = 0;
      for (const area of el.querySelectorAll<HTMLElement>("[data-fit-area]")) areas += area.offsetHeight;
      // 2px of room keeps a rounding step from starting a scrollbar.
      const free = el.clientHeight - padY - (content - areas) - 2;
      const fit = fitDeckLayout({ width, free, main, extra, side, master, sideUsed });
      if (fit.tile < 1) {
        clear();
        return;
      }
      const values: Record<string, string> = {
        cols: String(fit.cols),
        tw: `${fit.tile}px`,
        gap: `${FIT_GAP}px`,
        "rows-main": String(fit.rows.main),
        "rows-extra": String(fit.rows.extra),
        "rows-side": String(fit.rows.side),
      };
      for (const [name, value] of Object.entries(values)) {
        if (el.style.getPropertyValue(`--fit-${name}`) !== value) el.style.setProperty(`--fit-${name}`, value);
      }
      if (!el.hasAttribute("data-fit")) el.setAttribute("data-fit", "");
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    schedule();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resize?.observe(el);
    // A notice, an alert or the test hand opening changes the fixed part; the pane itself does not resize.
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
    mutations?.observe(el, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      mutations?.disconnect();
    };
  }, [el, enabled, main, extra, side, master, sideUsed]);
  return ref;
}
