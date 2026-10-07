"use client";

import { useEffect, useState } from "react";
import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";
import { getDuelCards } from "./api";

const infoCache = new Map<number, Promise<DuelCardInfo | null>>();

export function hasCardName(card: Pick<DuelCard, "code" | "name">): card is Pick<DuelCard, "code" | "name"> & { name: string } {
  return !!card.name?.trim() && card.name.trim() !== `Card ${card.code}`;
}

/** Exact passcode metadata shared by deck and field previews. Successful text
 * is cached per page load; a miss/error can be retried after a bundle update.
 */
export function loadDuelCardInfo(code: number): Promise<DuelCardInfo | null> {
  let pending = infoCache.get(code);
  if (!pending) {
    pending = getDuelCards([code]).then(
      ({ cards }) => {
        const card = cards.find(card => card.code === code) ?? null;
        if (!card || !hasCardName(card) || !card.description?.trim()) infoCache.delete(code);
        return card;
      },
      () => { infoCache.delete(code); return null; },
    );
    infoCache.set(code, pending);
  }
  return pending;
}

/** Undefined while loading, null when unknown. A null code suppresses lookup. */
export function useDuelCardInfo(code: number | null): DuelCardInfo | null | undefined {
  const [loaded, setLoaded] = useState<{ code: number; card: DuelCardInfo | null } | null>(null);
  useEffect(() => {
    if (code == null) return;
    let live = true;
    void loadDuelCardInfo(code).then(card => {
      if (live) setLoaded({ code, card });
    });
    return () => { live = false; };
  }, [code]);
  return code != null && loaded?.code === code ? loaded.card : undefined;
}
