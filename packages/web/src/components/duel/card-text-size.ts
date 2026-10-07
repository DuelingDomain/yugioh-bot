import type { CSSProperties } from "react";
import { useLayoutEffect, useSyncExternalStore } from "react";

/**
 * Browser-local presentation preference: how big the text of the card info panel and of the table UI is
 * (labels, HUD, chain and prompt text). Never sent to the duel server.
 */
export type CardTextSize = "small" | "medium" | "large" | "xlarge";

export const CARD_TEXT_SIZES: readonly CardTextSize[] = ["small", "medium", "large", "xlarge"];

export const CARD_TEXT_SIZE_LABEL: Readonly<Record<CardTextSize, string>> = { small: "Small", medium: "Medium", large: "Large", xlarge: "Extra large" };

export const DEFAULT_CARD_TEXT_SIZE: CardTextSize = "medium";

export const CARD_TEXT_SIZE_KEY = "yugidraft.duelCardTextSize.v1";

/** Multiplier of the effect text size. Medium is the base: about 15.5px at 1920 px wide. */
const SCALE: Readonly<Record<CardTextSize, number>> = { small: 0.85, medium: 1, large: 1.2, xlarge: 1.4 };

/**
 * Multiplier of the table UI text (the `--tt` property). Small and Medium keep the built-in sizes, which already
 * stand at 12px for labels and 14px for body text or more on screen; Large and Extra large grow them.
 */
const TABLE_SCALE: Readonly<Record<CardTextSize, number>> = { small: 1, medium: 1, large: 1.15, xlarge: 1.3 };

export function tableTextScale(size: CardTextSize): number {
  return TABLE_SCALE[size];
}

/** `--tt` as an inline style on a table root: the first paint has the saved size, with no jump after the effect. */
export function tableTextStyle(size: CardTextSize): CSSProperties {
  return { "--tt": String(TABLE_SCALE[size]) } as CSSProperties;
}

/**
 * `tableTextStyle` for the 3-way, 4-way and Tag tables. `--ft` lifts the old 10-11px text minimums to 12px (the 1v1 room
 * keeps them): modules write `calc((10px + 2px * var(--ft, 0)) * var(--tt, 1))`.
 */
export function multiTableTextStyle(size: CardTextSize): CSSProperties {
  return { ...tableTextStyle(size), "--ft": "1" } as CSSProperties;
}

/**
 * `--ft` on the document while a 3-way, 4-way or Tag table is open. The card menu and the card tooltip render into
 * `document.body`, outside the table root that sets it inline, and need the same small-text minimums as the table.
 * Call it from the multi table shells; the 1v1 room never does.
 */
export function useMultiTableTextFloor(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ft", "1");
    return () => { root.style.removeProperty("--ft"); };
  }, []);
}

export function isCardTextSize(value: unknown): value is CardTextSize {
  return typeof value === "string" && (CARD_TEXT_SIZES as readonly string[]).includes(value);
}

export function normalizeCardTextSize(value: unknown): CardTextSize {
  return isCardTextSize(value) ? value : DEFAULT_CARD_TEXT_SIZE;
}

/**
 * The `--ct` custom property of a size: the effect text size of the panel. The base grows with the window
 * (0.81vw, so 15.5px at 1920 and 16.2px at 2000) between 14px and 17px. The level multiplies the base, but the text
 * never drops under 14px, so Small is the smallest the panel gets.
 * The panel CSS derives the name, the type line and the owner line from it.
 */
export function cardTextStyle(size: CardTextSize): CSSProperties {
  return { "--ct": `max(14px, calc(${SCALE[size]} * clamp(14px, 0.81vw, 17px)))` } as CSSProperties;
}

export function loadCardTextSize(): CardTextSize {
  try {
    const raw = window.localStorage.getItem(CARD_TEXT_SIZE_KEY);
    return raw == null ? DEFAULT_CARD_TEXT_SIZE : normalizeCardTextSize(JSON.parse(raw));
  } catch { return DEFAULT_CARD_TEXT_SIZE; }
}

export function saveCardTextSize(value: CardTextSize): void {
  try { window.localStorage.setItem(CARD_TEXT_SIZE_KEY, JSON.stringify(normalizeCardTextSize(value))); }
  catch { /* The preference still works for this tab when storage is unavailable. */ }
}

// One store for the whole page, so the Settings control and every card panel agree at once. The server snapshot
// stays at the default for hydration; the first client read follows the saved value.
let current: CardTextSize = DEFAULT_CARD_TEXT_SIZE;
let loaded = false;
const listeners = new Set<() => void>();

export function getCardTextSize(): CardTextSize {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    current = loadCardTextSize();
  }
  return current;
}

export function subscribeCardTextSize(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setCardTextSize(value: CardTextSize): void {
  current = normalizeCardTextSize(value);
  loaded = true;
  saveCardTextSize(current);
  for (const listener of listeners) listener();
}

/** The saved card text size. Rerenders the caller when the viewer changes it. */
export function useCardTextSize(): CardTextSize {
  return useSyncExternalStore(subscribeCardTextSize, getCardTextSize, () => DEFAULT_CARD_TEXT_SIZE);
}

/**
 * Keeps `--tt` (the table text multiplier) on the page root while a duel table is shown, for the portals outside the table
 * roots. Every table CSS module reads `var(--tt, 1)`; the card panel reads `--ct`. Call it once, from `DuelRoomView` (or a
 * preview page): a shell that unmounts must not take the property away from the room. The table roots also set it inline.
 */
export function useTableTextScale(): void {
  const size = useCardTextSize();
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--tt", String(tableTextScale(size)));
    return () => { root.style.removeProperty("--tt"); };
  }, [size]);
}
