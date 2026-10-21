import { useSyncExternalStore } from "react";

/**
 * Browser-local presentation preference: whether hovering a card opens the card info drawer ("drawer", the default) or only a
 * click does ("off"). A click always pins the card in the drawer. Never sent to the duel server.
 */
export type CardHoverInfo = "drawer" | "off";

export const CARD_HOVER_INFO_VALUES: readonly CardHoverInfo[] = ["drawer", "off"];

export const CARD_HOVER_INFO_LABEL: Readonly<Record<CardHoverInfo, string>> = { drawer: "Drawer", off: "Off (click to open)" };

export const DEFAULT_CARD_HOVER_INFO: CardHoverInfo = "drawer";

export const CARD_HOVER_INFO_KEY = "yugidraft.duelCardHoverInfo.v1";

export function normalizeCardHoverInfo(value: unknown): CardHoverInfo {
  return value === "off" ? "off" : DEFAULT_CARD_HOVER_INFO;
}

function load(): CardHoverInfo {
  try {
    const raw = window.localStorage.getItem(CARD_HOVER_INFO_KEY);
    return raw == null ? DEFAULT_CARD_HOVER_INFO : normalizeCardHoverInfo(JSON.parse(raw));
  } catch { return DEFAULT_CARD_HOVER_INFO; }
}

// One store for the whole page, so the Settings control and every card drawer agree at once. The server snapshot stays at the
// default for hydration; the first client read follows the saved value.
let current: CardHoverInfo = DEFAULT_CARD_HOVER_INFO;
let loaded = false;
const listeners = new Set<() => void>();

export function getCardHoverInfo(): CardHoverInfo {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    current = load();
  }
  return current;
}

export function setCardHoverInfo(value: CardHoverInfo): void {
  current = normalizeCardHoverInfo(value);
  loaded = true;
  try { window.localStorage.setItem(CARD_HOVER_INFO_KEY, JSON.stringify(current)); }
  catch { /* The preference still works for this tab when storage is unavailable. */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The saved "Card info on hover" setting. Rerenders the caller when the viewer changes it. */
export function useCardHoverInfo(): CardHoverInfo {
  return useSyncExternalStore(subscribe, getCardHoverInfo, () => DEFAULT_CARD_HOVER_INFO);
}
