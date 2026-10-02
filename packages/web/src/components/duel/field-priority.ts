"use client";

import { useEffect, useState, type RefObject } from "react";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { getPhaseBeat } from "./phase-beats";
import { REVEAL_TIMING, waitForReveal, type AnimationLike, type AnimationSource } from "./prompt-reveal";

/** Finite board feedback counts; transitions, prompt entrances and ambient pulses do not. */
function pendingFieldAnimations(board: AnimationSource | null | undefined): AnimationLike[] {
  try {
    return (board?.getAnimations?.({ subtree: true }) ?? []).filter((animation) => {
      if (animation.playState === "finished" || animation.playState === "idle") return false;
      if (animation.constructor?.name === "CSSTransition" ||
        (typeof CSSTransition !== "undefined" && animation instanceof CSSTransition)) return false;
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (target?.closest("[data-prompt-panel]")) return false;
      return animation.effect?.getTiming?.().iterations !== Infinity;
    });
  } catch {
    return [];
  }
}

/**
 * Private opponent prompts use one capped wait for DOM/portal/Three.js effects and phase beats.
 * Local prompts use the room's reveal directly. New event batches hide opponent priority at once;
 * follow-up prompts without new events keep it visible. Ambient UI effects never add another beat.
 */
export function useFieldPriorityReady({
  events,
  waiting,
  board,
  reducedMotion,
  revealed = false,
}: {
  events: DuelEvent[];
  waiting: boolean;
  board: RefObject<HTMLElement | null>;
  reducedMotion: boolean;
  /** The room has already revealed this event batch to its prompt owner. */
  revealed?: boolean;
}): boolean {
  const eventId = events.at(-1)?.id;
  const key = waiting && eventId != null ? String(eventId) : null;
  const [readyKey, setReadyKey] = useState<string | null>(null);

  useEffect(() => {
    if (key == null || readyKey === key) return;
    if (revealed) {
      setReadyKey(key);
      return;
    }
    const controller = new AbortController();
    const source = () => board.current;
    void waitForReveal({
      source,
      // Even reduced-motion board banners must finish; shorten the beat and omit the settle.
      reducedMotion: false,
      timing: reducedMotion ? { beatMs: REVEAL_TIMING.reducedMs, settleMs: 0 } : undefined,
      pendingAnimations: pendingFieldAnimations,
      holdMs: () => Math.max(0, ...events.map((event) => (getPhaseBeat(event.id)?.endAt ?? 0) - performance.now())),
      signal: controller.signal,
    }).then((done) => {
      if (done && !controller.signal.aborted) setReadyKey(key);
    });
    return () => controller.abort();
    // One wait per event batch, not per prompt/actor or a preference change mid-effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revealed]);

  return revealed || key == null || readyKey === key;
}
