"use client";

/**
 * A human beat before a centred prompt panel appears.
 *
 * After an action (a Normal Summon that asks "Select the card(s) to add to your hand", an attack
 * that asks for a response) the panel must not pop up over the board FX. The rule:
 *   1. wait a short beat (REVEAL_TIMING.beatMs);
 *   2. then wait until the board's Web Animations (MoveFx, SummonFx, PositionFx) have finished,
 *      CSS animations/transitions and infinite loops excluded, re-checking in case one starts another;
 *   3. then a little settle time (settleMs);
 *   4. never longer than capMs in all. Reduced motion: one short fixed pause (reducedMs).
 * While the panel is hidden nothing answers the prompt: not right-click, Esc nor Enter.
 */
import { useEffect, useState, type RefObject } from "react";

export const REVEAL_TIMING = {
  /** The beat before a panel may appear. */
  beatMs: 450,
  /** Quiet time after the last board effect ends. */
  settleMs: 350,
  /** The panel never stays hidden longer than this. */
  capMs: 4000,
  /** Reduced motion: one short pause instead. */
  reducedMs: 150,
};

export type RevealTiming = typeof REVEAL_TIMING;

/** The part of a Web Animation the wait needs (a real `Animation` fits). */
export type AnimationLike = {
  finished: Promise<unknown>;
  playState?: string;
  effect?: { getTiming?: () => { iterations?: number } } | null;
};

/** Anything with `getAnimations`: the board element, or a stub in tests. */
export type AnimationSource = { getAnimations(options?: { subtree?: boolean }): AnimationLike[] };

function isCssDriven(animation: AnimationLike): boolean {
  const name = (animation as { constructor?: { name?: string } }).constructor?.name ?? "";
  if (name === "CSSAnimation" || name === "CSSTransition") return true;
  if (typeof CSSAnimation !== "undefined" && animation instanceof CSSAnimation) return true;
  if (typeof CSSTransition !== "undefined" && animation instanceof CSSTransition) return true;
  return false;
}

/**
 * The board animations worth waiting for: script-driven (element.animate) ones that are still
 * running. CSS animations and transitions, infinite loops, and finished or idle animations are left out.
 */
export function pendingBoardAnimations(source: AnimationSource | null | undefined): AnimationLike[] {
  if (!source || typeof source.getAnimations !== "function") return [];
  let all: AnimationLike[];
  try {
    all = source.getAnimations({ subtree: true });
  } catch {
    return [];
  }
  return all.filter((animation) => {
    if (isCssDriven(animation)) return false;
    if (animation.playState === "finished" || animation.playState === "idle") return false;
    let iterations: number | undefined;
    try {
      iterations = animation.effect?.getTiming?.().iterations;
    } catch {
      iterations = undefined;
    }
    return iterations !== Infinity;
  });
}

export type WaitForRevealOptions = {
  source: AnimationSource | null | undefined | (() => AnimationSource | null | undefined);
  reducedMotion: boolean;
  timing?: Partial<RevealTiming>;
  signal?: AbortSignal;
  /** Clock in ms; Date.now by default (fake timers drive it in tests). */
  now?: () => number;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const MAX_ROUNDS = 24;

let boardHoldUntil = 0;

/**
 * Keep a centred panel hidden for `ms` more. For FX that the board's getAnimations() cannot see,
 * such as the battle layer, which renders in a portal with CSS animations. The cap still applies.
 */
export function holdPromptReveal(ms: number): void {
  boardHoldUntil = Math.max(boardHoldUntil, Date.now() + ms);
}

export function clearPromptRevealHold(): void {
  boardHoldUntil = 0;
}

/** Time left on the FX hold (see holdPromptReveal); 0 when no FX layer holds the board. */
export function promptRevealHoldMs(): number {
  return Math.max(0, boardHoldUntil - Date.now());
}

/**
 * Resolves when the prompt panel may appear: true when the wait ran its course, false when it was
 * aborted (the prompt changed or the room unmounted).
 */
export async function waitForReveal(options: WaitForRevealOptions): Promise<boolean> {
  const timing = { ...REVEAL_TIMING, ...options.timing };
  const now = options.now ?? (() => Date.now());
  const { signal } = options;
  const aborted = () => signal?.aborted === true;
  const start = now();
  const elapsed = () => now() - start;

  if (options.reducedMotion) {
    await sleep(Math.min(timing.reducedMs, timing.capMs), signal);
    return !aborted();
  }

  await sleep(Math.min(timing.beatMs, timing.capMs), signal);
  if (aborted()) return false;

  // The board can only be quiet once the last effect ends, and an effect may start another one.
  const source = () => (typeof options.source === "function" ? options.source() : options.source);
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const budget = timing.capMs - timing.settleMs - elapsed();
    if (budget <= 0) break;
    const pending = pendingBoardAnimations(source());
    const holdMs = boardHoldUntil - Date.now();
    if (pending.length === 0 && holdMs <= 0) break;
    const waits: Promise<unknown>[] = [sleep(holdMs > 0 ? Math.min(holdMs, budget) : budget, signal)];
    if (pending.length > 0 && holdMs <= 0) waits.push(Promise.allSettled(pending.map((animation) => animation.finished)));
    await Promise.race(waits);
    if (aborted()) return false;
  }

  await sleep(Math.max(0, Math.min(timing.settleMs, timing.capMs - elapsed())), signal);
  return !aborted();
}

export type UsePromptRevealOptions = {
  /** The prompt that is about to be shown in the centre; null when nothing is centred. */
  promptId: string | null | undefined;
  /** The board element whose animations must finish first. */
  board: RefObject<HTMLElement | null>;
  reducedMotion: boolean;
  /**
   * The prompt continues the player's own pick (see continuesPick): show it at once, no beat.
   * Decided once per prompt id by the caller.
   */
  skip?: boolean;
};

/**
 * True when the centred panel for `promptId` may be shown. It turns false the moment a new prompt
 * arrives and true again once the board is quiet (see waitForReveal). With no prompt, or with `skip`, it is true.
 */
export function usePromptReveal({ promptId, board, reducedMotion, skip = false }: UsePromptRevealOptions): boolean {
  const [revealedId, setRevealedId] = useState<string | null>(null);

  useEffect(() => {
    if (!promptId || skip) return undefined;
    const controller = new AbortController();
    const source = () => board.current;
    void waitForReveal({ source, reducedMotion, signal: controller.signal }).then((done) => {
      if (done && !controller.signal.aborted) setRevealedId(promptId);
    });
    return () => controller.abort();
    // The reduced-motion preference is read when the wait starts; a change mid-wait is not worth a restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptId]);

  return !promptId || skip || revealedId === promptId;
}

/**
 * The prompt id to remember as "answerable": the first time the room was settled (no answer in
 * flight, no sync, no connection error) while this prompt was up. Pure so it can be tested.
 */
export function nextAnswerableId(
  current: string | null,
  promptId: string | null | undefined,
  settled: boolean,
): string | null {
  return promptId && settled ? promptId : current;
}

/**
 * True when the centred panel for `promptId` may be shown because it can be answered. A panel that
 * appears while the previous answer is still in flight, or while the room re-syncs, shows every
 * button disabled: it looks ready and is dead. This holds the panel back until the room is settled
 * once for that prompt; a later short sync does not hide it again (it would flicker and lose state).
 * With no prompt it is true. `skip` (a follow-up of the player's own pick) shows it at once: the buttons
 * stay off while the room is busy, so nothing can be clicked early, and the bar does not blink out.
 */
export function usePromptAnswerable(promptId: string | null | undefined, settled: boolean, skip = false): boolean {
  const [answerableId, setAnswerableId] = useState<string | null>(null);
  useEffect(() => {
    setAnswerableId((current) => nextAnswerableId(current, promptId, settled));
  }, [promptId, settled]);
  return !promptId || skip || answerableId === promptId;
}
