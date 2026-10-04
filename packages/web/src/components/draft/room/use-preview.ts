"use client";

import { useEffect, useRef, useState } from "react";
import { previewDelay } from "./preview-model";
import type { RoomCard } from "./room-model";

export interface PreviewState {
  card: RoomCard;
  /** Reached straight from another preview (or right after one): no fade. */
  instant: boolean;
}

/**
 * Which card the large preview shows. It opens after a short rest on a card, closes the moment the target goes,
 * and opens at once when the target moves from one card to another.
 */
export function usePreviewCard(target: RoomCard | null): PreviewState | null {
  const [state, setState] = useState<PreviewState | null>(null);
  const visible = useRef(false);
  const hiddenAt = useRef<number | null>(null);
  const id = target ? target.id : null;

  useEffect(() => {
    if (id == null || !target) {
      if (visible.current) {
        visible.current = false;
        hiddenAt.current = Date.now();
        setState(null);
      }
      return;
    }
    const delay = previewDelay({ visible: visible.current, hiddenAt: hiddenAt.current, now: Date.now() });
    const show = () => {
      visible.current = true;
      setState({ card: target, instant: delay === 0 });
    };
    if (delay === 0) {
      show();
      return;
    }
    const timer = setTimeout(show, delay);
    return () => clearTimeout(timer);
    // The target object is read when the timer fires; only a new card id restarts the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return state;
}
