"use client";

import { useCallback, useRef, useState } from "react";
import { useDraftStore, type DraftState } from "@/lib/stores/draft-store";
import { stepKeyOf, type RoomCard } from "./room-model";

export interface PickAttempt {
  stepKey: string;
  packIds: ReadonlySet<number>;
}

interface PickHooks {
  onSent?: (cardId: number, attempt: PickAttempt) => void;
  onRejected?: () => void;
  onReconciled?: (attempt: PickAttempt, pool: RoomCard[]) => void;
}

/**
 * Picks a card the way the old card grid did: the stale-turn guard, an optimistic local pick,
 * then the request. A failed request refetches the whole draft so the room stays consistent.
 * pick() resolves true when the request was sent. Pending stays reactive through the refetch.
 */
export function usePick(slug: string, hooks?: PickHooks) {
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const pick = useCallback(
    async (cardId: number): Promise<boolean> => {
      const state = useDraftStore.getState();
      const canPick = state.isMyTurn && state.currentPack.some((card) => card.id === cardId && !card.blocked);
      if (pendingRef.current || !canPick) {
        state.setPreviewCard(null);
        state.setSelectedCard(null);
        state.setHighlightedIndex(-1);
        return false;
      }
      const attempt: PickAttempt = {
        stepKey: stepKeyOf(state.packRound, state.pickStep),
        packIds: new Set(state.currentPack.map((card) => card.id)),
      };
      pendingRef.current = true;
      setPending(true);
      state.pickCard(cardId);
      hooks?.onSent?.(cardId, attempt);
      try {
        const res = await fetch(`/api/drafts/${slug}/pick`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId }),
        });
        if (!res.ok) throw new Error(`Pick failed: ${res.status}`);
        const data: Partial<DraftState> = await res.json();
        useDraftStore.getState().setFromServer(data);
        hooks?.onReconciled?.(attempt, data.myPool ?? []);
      } catch (err) {
        console.error("Pick error:", err);
        hooks?.onRejected?.();
        try {
          const refresh = await fetch(`/api/drafts/${slug}`);
          if (refresh.ok) {
            const data: Partial<DraftState> = await refresh.json();
            useDraftStore.getState().setFromServer(data);
            hooks?.onReconciled?.(attempt, data.myPool ?? []);
          }
        } catch (refreshErr) {
          console.error("Failed to refresh draft state:", refreshErr);
        }
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
      return true;
    },
    [slug, hooks],
  );
  return { pick, pending };
}
