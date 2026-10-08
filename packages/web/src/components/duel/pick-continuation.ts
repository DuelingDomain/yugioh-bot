"use client";

/**
 * A pick on the board (Synchro / Xyz / Link / Fusion materials) reaches the web as a chain of one-card
 * "toggle" prompts: each click answers the prompt and the engine asks again with a NEW prompt id.
 * The centred bar must not vanish for a reveal beat between those clicks. A follow-up of the same pick
 * shows at once; only a really new decision keeps its beat (see prompt-reveal.ts).
 */
import { duelFxClock } from "./fx-clock";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DuelAnswer, DuelPrompt } from "@yugidraft/shared/duels";
import { isBoardTogglePrompt } from "./prompt-center";
import { GATE_TIMING } from "./duel-timing";
import { LOCATION_HAND, TYPE_SPELL, TYPE_TRAP } from "./constants";

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

/**
 * The zone or tribute prompt that follows the player's own action (Normal Summon, Set, Activate...) or their tribute
 * pick. The player just chose what to place, so the next question is "where": no board effect is playing for it, and
 * the bar and the zone clicks must not wait for a reveal beat. Any other follow-up (a search after a summon,
 * a chain window) keeps its beat, because an effect is on screen. Pure, so the rule can be tested.
 */
export function continuesPlacement(previous: DuelPrompt | null | undefined, next: DuelPrompt | null | undefined): boolean {
  if (!previous || !next || previous.id === next.id || previous.seat !== next.seat) return false;
  if (next.kind === "places") return previous.context?.type === "action" || previous.kind === "tribute";
  if (next.kind === "tribute") return previous.context?.type === "action";
  return false;
}

/** The phase moves of the action prompt (see phase-hub-model.ts). */
const PHASE_MOVES = ["to_bp", "to_m2", "to_ep"];

/** The answer to the action menu is a phase move: Battle Phase, Main Phase 2 or End Phase. */
export function movesPhase(target: DuelPrompt, answer: DuelAnswer): boolean {
  return !answer.cancel && target.context?.type === "action" && answer.choice != null && PHASE_MOVES.includes(answer.choice);
}

/**
 * The question that follows the player's own phase move (for example "Return this Deck Master to the Deck Master Zone?" at the
 * Battle Phase): the player just chose to move on, no board effect is playing for it, so the panel must not wait for a reveal
 * beat. Only a response of the same seat counts; a zone or a search keeps its beat. Pure, so the rule can be tested.
 */
export function continuesPhaseMove(previous: DuelPrompt | null | undefined, next: DuelPrompt | null | undefined): boolean {
  if (!previous || !next || previous.id === next.id || previous.seat !== next.seat) return false;
  return next.kind === "choice" && previous.context?.type === "action";
}

/**
 * A continuing prompt skips the "answerable" wait (it shows while the player's own answer is still in flight, buttons off)
 * but not while the room re-reads for a change notice that is not that echo (`catchingUp`): the bar would look ready and
 * every click would be refused until the read ends. Then it waits for the room to settle like any other prompt.
 */
export function skipsAnswerableWait(continuing: boolean, catchingUp: boolean): boolean {
  return continuing && !catchingUp;
}

/** Action choices that ask for a zone before anything can go on the chain. */
const PLACING_ACTIONS = ["summon:", "mset:", "sset:", "spsummon:"];

/**
 * The answer to `target` is an action that asks "where" before any chain can start: a Normal or Special Summon, a Set,
 * or a Spell/Trap card activated from the hand. A monster effect, a battle action or a phase change is not: a chain
 * or an effect may play first, so the zone prompt that follows later (an effect's own) keeps its beat. A tribute pick
 * always leads to the zone of the card being summoned.
 */
export function placesBeforeChain(target: DuelPrompt, answer: DuelAnswer): boolean {
  if (answer.cancel) return false;
  if (target.kind === "tribute") return true;
  if (target.context?.type !== "action" || !answer.choice) return false;
  const choice = answer.choice;
  if (PLACING_ACTIONS.some((prefix) => choice.startsWith(prefix))) return true;
  if (!choice.startsWith("activate:")) return false;
  const option = target.options.find((candidate) => candidate.id === choice);
  const type = option?.card?.type ?? 0;
  return option?.location === LOCATION_HAND && (type & (TYPE_SPELL | TYPE_TRAP)) !== 0;
}

/** True when `answer` to `prompt` leaves the pick open (a card click); Finish and Cancel end it. */
export function keepsPickOpen(prompt: DuelPrompt | null | undefined, answer: DuelAnswer): boolean {
  return isBoardTogglePrompt(prompt ?? null) && !answer.finish && !answer.cancel;
}

export type PickContinuation = {
  /** The current prompt follows the player's own click on the same pick, or their own action (see continuesPlacement): show it at once. */
  continuing: boolean;
  /**
   * The pick just answered, while the engine has not sent a prompt yet. Keep drawing it, buttons off,
   * so the bar does not blink out. Null once a prompt is there or the hold ran out.
   */
  waiting: DuelPrompt | null;
  /** Tell the hook that the player answered `prompt`. */
  noteAnswer: (prompt: DuelPrompt, answer: DuelAnswer) => void;
};

/**
 * `revision` is the engine revision of the room. A new revision with no prompt for this player means the engine moved on
 * (a chain, an opponent's turn, an effect that resolves): the chance of a quick zone prompt is over.
 */
export function usePickContinuation(prompt: DuelPrompt | null | undefined, revision?: number | null): PickContinuation {
  const answered = useRef<DuelPrompt | null>(null);
  const placing = useRef<{ prompt: DuelPrompt; revision: number | null | undefined; phase?: boolean } | null>(null);
  const latestRevision = useRef(revision);
  latestRevision.current = revision;
  const decided = useRef<{ id: string | null; continuing: boolean }>({ id: null, continuing: false });
  const windowTimer = useRef<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof duelFxClock.setTimeout> | null>(null);
  const [waiting, setWaiting] = useState<DuelPrompt | null>(null);

  // Decided while rendering, once per prompt id, so the very first frame of a follow-up already shows.
  // The answer is used up by the next prompt, whatever it is (an opponent prompt ends the chance).
  if (!prompt && placing.current && revision != null && placing.current.revision != null && revision !== placing.current.revision) {
    placing.current = null;
  }
  if (prompt && decided.current.id !== prompt.id) {
    decided.current = { id: prompt.id, continuing: continuesPick(answered.current, prompt) ||
      (placing.current?.phase ? continuesPhaseMove(placing.current.prompt, prompt) : continuesPlacement(placing.current?.prompt, prompt)) };
    answered.current = null;
    placing.current = null;
  }

  const noteAnswer = useCallback((target: DuelPrompt, answer: DuelAnswer) => {
    if (windowTimer.current) window.clearTimeout(windowTimer.current);
    if (holdTimer.current) duelFxClock.clearTimeout(holdTimer.current);
    // The answer to a summon, a set, a Spell/Trap activation or a tribute pick is followed by the zone prompt for that card.
    // A phase move is followed by a question of the same seat (see continuesPhaseMove).
    placing.current = placesBeforeChain(target, answer) || movesPhase(target, answer)
      ? { prompt: target, revision: latestRevision.current, phase: movesPhase(target, answer) } : null;
    if (!keepsPickOpen(target, answer)) {
      answered.current = null;
      setWaiting(null);
    } else {
      answered.current = target;
      setWaiting(target);
      holdTimer.current = duelFxClock.setTimeout(() => setWaiting(null), PICK_CONTINUATION.holdMs);
    }
    windowTimer.current = window.setTimeout(() => {
      answered.current = null;
      placing.current = null;
    }, PICK_CONTINUATION.windowMs);
  }, []);

  // A newer prompt ends the hold.
  const promptId = prompt?.id;
  useEffect(() => {
    setWaiting((current) => (current && promptId && promptId !== current.id ? null : current));
  }, [promptId]);

  useEffect(
    () => () => {
      if (windowTimer.current) window.clearTimeout(windowTimer.current);
      if (holdTimer.current) duelFxClock.clearTimeout(holdTimer.current);
    },
    [],
  );

  return {
    continuing: prompt != null && decided.current.id === prompt.id && decided.current.continuing,
    waiting: prompt ? null : waiting,
    noteAnswer,
  };
}
