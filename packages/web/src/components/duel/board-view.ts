"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/** "classic" is the flat board; "3d" is the tilted Solid Vision table (1v1 only). */
export type BoardMode = "classic" | "3d";
export type BoardTilt = "tilt" | "flat";
export type BoardViewSetting = { mode: BoardMode; tilt: BoardTilt };

/**
 * A separate key, not a field of yugidraft.duelPreferences.v1: savePrefs() rewrites that whole object,
 * so a field added there would be lost.
 */
export const BOARD_VIEW_KEY = "yugidraft.duelBoardView.v1";

export const DEFAULT_BOARD_VIEW: BoardViewSetting = Object.freeze({ mode: "classic", tilt: "tilt" });

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: BoardViewSetting } = { raw: null, value: DEFAULT_BOARD_VIEW };

function parse(raw: string | null): BoardViewSetting {
  if (!raw) return DEFAULT_BOARD_VIEW;
  try {
    const rec: unknown = JSON.parse(raw);
    if (!rec || typeof rec !== "object") return DEFAULT_BOARD_VIEW;
    const { v, mode, tilt } = rec as Record<string, unknown>;
    if (v !== 1 || (mode !== "classic" && mode !== "3d") || (tilt !== "tilt" && tilt !== "flat")) return DEFAULT_BOARD_VIEW;
    return mode === DEFAULT_BOARD_VIEW.mode && tilt === DEFAULT_BOARD_VIEW.tilt ? DEFAULT_BOARD_VIEW : { mode, tilt };
  } catch {
    return DEFAULT_BOARD_VIEW;
  }
}

/** The stored setting on this device. Bad or missing data gives the default. The result is stable between writes. */
export function readBoardView(): BoardViewSetting {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(BOARD_VIEW_KEY);
  } catch {
    // storage blocked: the default
  }
  if (raw !== cache.raw) cache = { raw, value: parse(raw) };
  return cache.value;
}

/** Saves the setting and tells the listeners of this tab. Other tabs and pop-outs hear the `storage` event. */
export function writeBoardView(next: BoardViewSetting): void {
  try {
    window.localStorage.setItem(BOARD_VIEW_KEY, JSON.stringify({ v: 1, mode: next.mode, tilt: next.tilt }));
  } catch {
    // private mode / quota: the setting then lasts until the page closes only through the listeners below
    cache = { raw: cache.raw, value: next };
  }
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === BOARD_VIEW_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export type BoardView = BoardViewSetting & {
  setMode: (mode: BoardMode) => void;
  setTilt: (tilt: BoardTilt) => void;
};

/**
 * The board look of this device. `override` (the page query `?view=3d|classic`) wins for the mode and is never saved.
 * The server snapshot is the default; the room reads its data on the client, so the board never renders in server HTML.
 */
export function useBoardView(override?: BoardMode): BoardView {
  const stored = useSyncExternalStore(subscribe, readBoardView, () => DEFAULT_BOARD_VIEW);
  const setMode = useCallback((mode: BoardMode) => writeBoardView({ ...readBoardView(), mode }), []);
  const setTilt = useCallback((tilt: BoardTilt) => writeBoardView({ ...readBoardView(), tilt }), []);
  const mode = override ?? stored.mode;
  return useMemo(() => ({ mode, tilt: stored.tilt, setMode, setTilt }), [mode, stored.tilt, setMode, setTilt]);
}
