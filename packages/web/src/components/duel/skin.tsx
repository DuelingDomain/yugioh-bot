"use client";

import { createContext, useContext, useMemo } from "react";

/** The places a look can add class names. One slot per skinned CSS module. */
export type DuelSkinSlot = "field" | "station" | "lp" | "feedback" | "side" | "inspector" | "history"
  | "menu" | "pile" | "prompt" | "tray" | "precheck" | "chain" | "battle";
export type DuelSkin = Partial<Record<DuelSkinSlot, Readonly<Record<string, string>>>>;

const SkinContext = createContext<DuelSkin | null>(null);

export const DuelSkinProvider = SkinContext.Provider;

const merged = new WeakMap<object, WeakMap<object, unknown>>();

/**
 * Returns `base` unchanged when there is no provider or the skin has no such slot (the classic board).
 * Otherwise every key of `base` gets the skin's classes added after its own. The result is memoised per
 * (base, skin slot), so it is stable between renders.
 */
export function useSkinStyles<T extends Readonly<Record<string, string>>>(base: T, slot: DuelSkinSlot): T {
  const extra = useContext(SkinContext)?.[slot];
  return useMemo(() => {
    if (!extra) return base;
    let bySkin = merged.get(base);
    if (!bySkin) merged.set(base, (bySkin = new WeakMap()));
    let out = bySkin.get(extra) as T | undefined;
    if (!out) {
      const next: Record<string, string> = {};
      for (const key of Object.keys(base)) next[key] = extra[key] ? `${base[key]} ${extra[key]}` : base[key];
      bySkin.set(extra, (out = next as T));
    }
    return out;
  }, [base, extra]);
}
