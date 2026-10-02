"use client";

import { useEffect, useState, type RefObject } from "react";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { getPhaseBeat } from "./phase-beats";
import { promptRevealHoldMs, waitForReveal } from "./prompt-reveal";

/** CSS feedback banners also count here; infinite usable-card/ambient pulses never block. */
function boardIsAnimating(board: HTMLElement | null): boolean {
  try {
    return (board?.getAnimations?.({ subtree: true }) ?? []).some((animation) =>
      animation.playState !== "finished" && animation.playState !== "idle" &&
      animation.effect?.getTiming().iterations !== Infinity);
  } catch {
    return false;
  }
}

/**
 * Wait for the same DOM/portal/Three.js effects as prompts, and for the turn-start phase beats.
 * A prompt panel has a timeout so it cannot strand the player; the visual priority signal stays
 * off if effects outlast that timeout. New event batches hide it immediately. Follow-up prompts
 * without new events keep it visible, and changing the actor never changes whose turn it is.
 */
export function useFieldPriorityReady({
  events,
  waiting,
  board,
  reducedMotion,
}: {
  events: DuelEvent[];
  waiting: boolean;
  board: RefObject<HTMLElement | null>;
  reducedMotion: boolean;
}): boolean {
  const eventId = events.at(-1)?.id;
  const key = waiting && eventId != null ? String(eventId) : null;
  const [readyKey, setReadyKey] = useState<string | null>(null);

  useEffect(() => {
    if (key == null) return;
    const controller = new AbortController();
    const source = () => board.current;
    const stillPlaying = () => boardIsAnimating(source()) || promptRevealHoldMs() > 0 ||
      events.some((event) => (getPhaseBeat(event.id)?.endAt ?? 0) > performance.now());
    void (async () => {
      while (await waitForReveal({ source, reducedMotion, signal: controller.signal })) {
        if (controller.signal.aborted) return;
        if (!stillPlaying()) {
          setReadyKey(key);
          return;
        }
      }
    })();
    return () => controller.abort();
    // One wait per event batch, not per prompt/actor or a preference change mid-effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return key == null || readyKey === key;
}
