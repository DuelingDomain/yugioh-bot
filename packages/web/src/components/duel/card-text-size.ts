import type { CSSProperties } from "react";
import { useSyncExternalStore } from "react";

/** Browser-local presentation preference: how big the text of the card info panel is. Never sent to the duel server. */
export type CardTextSize = "small" | "medium" | "large" | "xlarge";

export const CARD_TEXT_SIZES: readonly CardTextSize[] = ["small", "medium", "large", "xlarge"];

export const CARD_TEXT_SIZE_LABEL: Readonly<Record<CardTextSize, string>> = { small: "Small", medium: "Medium", large: "Large", xlarge: "Extra large" };

export const DEFAULT_CARD_TEXT_SIZE: CardTextSize = "medium";

export const CARD_TEXT_SIZE_KEY = "yugidraft.duelCardTextSize.v1";

/** Multiplier of the effect text size. Medium is the base: about 15.5px at 1920 px wide. */
const SCALE: Readonly<Record<CardTextSize, number>> = { small: 0.85, medium: 1, large: 1.2, xlarge: 1.4 };

export function isCardTextSize(value: unknown): value is CardTextSize {
  return typeof value === "string" && (CARD_TEXT_SIZES as readonly string[]).includes(value);
}

export function normalizeCardTextSize(value: unknown): CardTextSize {
  return isCardTextSize(value) ? value : DEFAULT_CARD_TEXT_SIZE;
}

/**
 * The `--ct` custom property of a size: the effect text size of the panel. The base grows with the window
 * (0.81vw, so 15.5px at 1920 and 16.2px at 2000) between 13px and 17px. The level multiplies the base.
 * The panel CSS derives the name, the type line and the owner line from it.
 */
export function cardTextStyle(size: CardTextSize): CSSProperties {
  return { "--ct": `calc(${SCALE[size]} * clamp(13px, 0.81vw, 17px))` } as CSSProperties;
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
