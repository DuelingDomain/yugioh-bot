import { useSyncExternalStore } from "react";

/**
 * Browser-local presentation preference: how the dice of the 3-way and 4-way opening look on this screen.
 * Never sent to the duel server. The registry has a `locked` state so a skin can become an unlockable later;
 * every skin is unlocked now, and there is no unlock system.
 */
export type DiceSkinId = "gold" | "crest" | "cardback";

export interface DiceSkin {
  id: DiceSkinId;
  label: string;
  note: string;
  state: "unlocked" | "locked";
}

export const DICE_SKINS: readonly DiceSkin[] = [
  { id: "gold", label: "Millennium gold", note: "Gold die with a sun mark on the six", state: "unlocked" },
  { id: "crest", label: "Crest", note: "Dark die with a crest on each face", state: "unlocked" },
  { id: "cardback", label: "Card back", note: "Card-back pattern on each face", state: "unlocked" },
];

export const DEFAULT_DICE_SKIN: DiceSkinId = "gold";

export const DICE_SKIN_KEY = "yugidraft.duelDiceSkin.v1";

export function isDiceSkin(value: unknown): value is DiceSkinId {
  return typeof value === "string" && DICE_SKINS.some((skin) => skin.id === value);
}

export function isSkinUnlocked(id: DiceSkinId): boolean {
  return DICE_SKINS.find((skin) => skin.id === id)?.state === "unlocked";
}

/** A saved value that is unknown or locked falls back to the default. */
export function normalizeDiceSkin(value: unknown): DiceSkinId {
  return isDiceSkin(value) && isSkinUnlocked(value) ? value : DEFAULT_DICE_SKIN;
}

export function loadDiceSkin(): DiceSkinId {
  try {
    const raw = window.localStorage.getItem(DICE_SKIN_KEY);
    return raw == null ? DEFAULT_DICE_SKIN : normalizeDiceSkin(JSON.parse(raw));
  } catch { return DEFAULT_DICE_SKIN; }
}

export function saveDiceSkin(value: DiceSkinId): void {
  try { window.localStorage.setItem(DICE_SKIN_KEY, JSON.stringify(normalizeDiceSkin(value))); }
  catch { /* The preference still works for this tab when storage is unavailable. */ }
}

// One store for the page, so the Settings control and the opening agree at once. The server snapshot stays at the
// default for hydration; the first client read follows the saved value.
let current: DiceSkinId = DEFAULT_DICE_SKIN;
let loaded = false;
const listeners = new Set<() => void>();

export function getDiceSkin(): DiceSkinId {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    current = loadDiceSkin();
  }
  return current;
}

export function subscribeDiceSkin(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setDiceSkin(value: DiceSkinId): void {
  current = normalizeDiceSkin(value);
  loaded = true;
  saveDiceSkin(current);
  for (const listener of listeners) listener();
}

/** The saved dice skin. Rerenders the caller when the viewer changes it. */
export function useDiceSkin(): DiceSkinId {
  return useSyncExternalStore(subscribeDiceSkin, getDiceSkin, () => DEFAULT_DICE_SKIN);
}
