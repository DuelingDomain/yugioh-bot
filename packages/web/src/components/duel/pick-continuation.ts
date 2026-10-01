"use client";

/**
 * A pick on the board (Synchro / Xyz / Link / Fusion materials) reaches the web as a chain of one-card
 * "toggle" prompts: each click answers the prompt and the engine asks again with a NEW prompt id.
 * The centred bar must not vanish for a reveal beat between those clicks. A follow-up of the same pick
 * shows at once; only a really new decision keeps its beat (see prompt-reveal.ts).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DuelAnswer, DuelPrompt } from "@yugidraft/shared/duels";
import { isBoardTogglePrompt } from "./prompt-center";
import { GATE_TIMING } from "./duel-timing";

export const PICK_CONTINUATION = {
  /** A follow-up prompt counts only when it arrives within this time of the player's own click. */
  windowMs: 4000,
  /** The last bar stays up (buttons off) this long when no prompt is there yet. */
  holdMs: GATE_TIMING.pickHoldMs,
};

/**
 * The same pick: both are board toggle prompts of the same seat with the same title, description,
 * context and source card, and the next is a fresh prompt (new id). The chosen set and the option
 * list are left out on purpose: they change with every click.
 */
export function continuesPick(previous: DuelPrompt | null | undefined, next: DuelPrompt | null | undefined): boolean {
  if (!previous || !next || previous.id === next.id) return false;
  if (!isBoardTogglePrompt(previous) || !isBoardTogglePrompt(next)) return false;
  return (
    previous.seat === next.seat &&
    previous.title === next.title &&
    (previous.description ?? "") === (next.description ?? "") &&
    previous.context?.type === next.context?.type &&
    (previous.source?.name ?? "") === (next.source?.name ?? "")
  );
}

/** True when `answer` to `prompt` leaves the pick open (a card click); Finish and Cancel end it. */
export function keepsPickOpen(prompt: DuelPrompt | null | undefined, answer: DuelAnswer): boolean {
  return isBoardTogglePrompt(prompt ?? null) && !answer.finish && !answer.cancel;
}

export type PickContinuation = {
  /** The current prompt follows the player's own click on the same pick: show it at once. */
  continuing: boolean;
  /**
   * The pick just answered, while the engine has not sent a prompt yet. Keep drawing it, buttons off,
   * so the bar does not blink out. Null once a prompt is there or the hold ran out.
   */
  waiting: DuelPrompt | null;
  /** Tell the hook that the player answered `prompt`. */
  noteAnswer: (prompt: DuelPrompt, answer: DuelAnswer) => void;
};

export function usePickContinuation(prompt: DuelPrompt | null | undefined): PickContinuation {
  const answered = useRef<DuelPrompt | null>(null);
  const decided = useRef<{ id: string | null; continuing: boolean }>({ id: null, continuing: false });
  const windowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [waiting, setWaiting] = useState<DuelPrompt | null>(null);

  // Decided while rendering, once per prompt id, so the very first frame of a follow-up already shows.
  // The answer is used up by the next prompt, whatever it is (an opponent prompt ends the chance).
  if (prompt && decided.current.id !== prompt.id) {
    decided.current = { id: prompt.id, continuing: continuesPick(answered.current, prompt) };
    answered.current = null;
  }

  const noteAnswer = useCallback((target: DuelPrompt, answer: DuelAnswer) => {
    if (windowTimer.current) clearTimeout(windowTimer.current);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (!keepsPickOpen(target, answer)) {
      answered.current = null;
      setWaiting(null);
      return;
    }
    answered.current = target;
    windowTimer.current = setTimeout(() => {
      answered.current = null;
    }, PICK_CONTINUATION.windowMs);
    setWaiting(target);
    holdTimer.current = setTimeout(() => setWaiting(null), PICK_CONTINUATION.holdMs);
  }, []);

  // A newer prompt ends the hold.
  const promptId = prompt?.id;
  useEffect(() => {
    setWaiting((current) => (current && promptId && promptId !== current.id ? null : current));
  }, [promptId]);

  useEffect(
    () => () => {
      if (windowTimer.current) clearTimeout(windowTimer.current);
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  return {
    continuing: prompt != null && decided.current.id === prompt.id && decided.current.continuing,
    waiting: prompt ? null : waiting,
    noteAnswer,
  };
}
