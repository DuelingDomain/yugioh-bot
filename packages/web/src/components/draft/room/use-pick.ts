"use client";

import { useCallback, useRef } from "react";
import { useDraftStore } from "@/lib/stores/draft-store";

/**
 * Picks a card the way the old card grid did: the stale-turn guard, an optimistic local pick,
 * then the request. A failed request refetches the whole draft so the room stays consistent.
 * Resolves true when the pick was sent.
 */
export function usePick(slug: string, hooks?: { onSent?: (cardId: number) => void; onRejected?: () => void }) {
  const pending = useRef(false);
  return useCallback(
    async (cardId: number): Promise<boolean> => {
      const state = useDraftStore.getState();
      const canPick = state.isMyTurn && state.currentPack.some((card) => card.id === cardId);
      if (pending.current || !canPick) {
        state.setPreviewCard(null);
        state.setSelectedCard(null);
        state.setHighlightedIndex(-1);
        return false;
      }
      pending.current = true;
      state.pickCard(cardId);
      hooks?.onSent?.(cardId);
      try {
        const res = await fetch(`/api/drafts/${slug}/pick`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId }),
        });
        if (!res.ok) throw new Error(`Pick failed: ${res.status}`);
        useDraftStore.getState().setFromServer(await res.json());
      } catch (err) {
        console.error("Pick error:", err);
        hooks?.onRejected?.();
        try {
          const refresh = await fetch(`/api/drafts/${slug}`);
          if (refresh.ok) useDraftStore.getState().setFromServer(await refresh.json());
        } catch (refreshErr) {
          console.error("Failed to refresh draft state:", refreshErr);
        }
      } finally {
        pending.current = false;
      }
      return true;
    },
    [slug, hooks],
  );
}
