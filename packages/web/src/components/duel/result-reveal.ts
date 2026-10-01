"use client";

/**
 * When the result screen ("YOU WIN" / "YOU LOSE") may cover the board.
 *
 * Before: it showed the moment the engine result (or a finished status) arrived, so it hid the final
 * attack, the LP roll to 0 and the card breaking up. Now the final action plays out first:
 *   1. wait until the board is quiet: no running script animation (MoveFx, SummonFx, PositionFx), no FX
 *      hold (battle, summon, destroy), no card flight (movesSettleAt) and no LP counter rolling;
 *   2. then a human pause (RESULT_TIMING.pauseMs) of continued quiet; a new effect in that time restarts it;
 *   3. never later than RESULT_TIMING.capMs after the end, so a stuck FX signal cannot hide the result.
 * No wait at all for a duel that was already finished when the room opened (a reload, a link), and for
 * endings that have no board FX (surrender, time limit, lost connection, interrupted or cancelled table).
 * Reduced motion: one short pause (RESULT_TIMING.reducedPauseMs).
 *
 * `resultGate` is the whole decision as a pure function; `useResultGate` feeds it with the clock and the board.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import type { DuelStatus } from "@yugidraft/shared/duels";
import { classifyResultReason, type DuelResultReasonKind } from "./duel-result";
import { GATE_TIMING } from "./duel-timing";
import { lpMotionRemainingMs } from "./lp-motion";
import { movesSettleAt } from "./move-plan";
import { pendingBoardAnimations, promptRevealHoldMs, type AnimationSource } from "./prompt-reveal";

export const RESULT_TIMING = {
  /** Quiet time on the board before the screen shows: the pause a person takes after the last blow. */
  pauseMs: GATE_TIMING.resultPauseMs,
  /** The screen shows at the latest this long after the end, whatever the board does. */
  capMs: GATE_TIMING.resultCapMs,
  /** Reduced motion: one short pause instead. */
  reducedPauseMs: GATE_TIMING.resultReducedPauseMs,
  /** How often the hook looks at the board. */
  tickMs: 100,
};

export type ResultTiming = typeof RESULT_TIMING;

export type ResultGateInput = {
  /** The duel is over (an engine result, or a status past "active"). */
  over: boolean;
  /** The end came while this room was open on a running duel. False for a duel already finished when it opened. */
  live: boolean;
  status: DuelStatus;
  reasonKind: DuelResultReasonKind;
  reducedMotion: boolean;
  /** Time since the end was first seen. */
  sinceEndMs: number;
  /** How long the board has been quiet without a break; null when it is busy now. */
  quietForMs: number | null;
};

export type ResultGate =
  | { show: false; reason: "not-over" | "waiting" }
  | { show: true; reason: "opened-finished" | "off-board" | "reduced" | "quiet" | "cap" };

/** Endings the board does not play out: nothing to wait for. */
function endsOffBoard(status: DuelStatus, reasonKind: DuelResultReasonKind): boolean {
  return status === "interrupted" || status === "cancelled" ||
    reasonKind === "surrender" || reasonKind === "time" || reasonKind === "connection";
}

export function resultGate(input: ResultGateInput, timing: ResultTiming = RESULT_TIMING): ResultGate {
  if (!input.over) return { show: false, reason: "not-over" };
  if (!input.live) return { show: true, reason: "opened-finished" };
  if (endsOffBoard(input.status, input.reasonKind)) return { show: true, reason: "off-board" };
  if (input.reducedMotion) {
    return input.sinceEndMs >= timing.reducedPauseMs ? { show: true, reason: "reduced" } : { show: false, reason: "waiting" };
  }
  if (input.sinceEndMs >= timing.capMs) return { show: true, reason: "cap" };
  if (input.quietForMs != null && input.quietForMs >= timing.pauseMs) return { show: true, reason: "quiet" };
  return { show: false, reason: "waiting" };
}

/** True when nothing on the board is moving: the last FX of the duel has finished. */
export function boardQuietNow(board: AnimationSource | null | undefined): boolean {
  const stamp = typeof performance !== "undefined" ? performance.now() : Date.now();
  return pendingBoardAnimations(board).length === 0 &&
    promptRevealHoldMs() <= 0 &&
    lpMotionRemainingMs() <= 0 &&
    movesSettleAt(stamp) <= stamp;
}

export type UseResultGateOptions = {
  slug: string;
  status: DuelStatus | undefined;
  /** The engine view carries a result. */
  hasResult: boolean;
  /** The engine's reason text (or the saved one); picks the ending kind. */
  reason: string | null | undefined;
  reducedMotion: boolean;
  /** The board element whose animations must finish first. */
  board: RefObject<AnimationSource | null>;
};

/**
 * True when the result screen may show. Turns true at once for a duel that was finished on arrival or
 * ended off the board, otherwise after the board is quiet and the pause has passed (see resultGate).
 */
export function useResultGate({ slug, status, hasResult, reason, reducedMotion, board }: UseResultGateOptions): boolean {
  const over = status != null && status !== "lobby" && (status !== "active" || hasResult);
  // The duel counts as live once this room has seen it running; a room that opens on a finished duel never has.
  const liveSlug = useRef<string | null>(null);
  if (status === "active" && !hasResult) liveSlug.current = slug;
  const input = {
    over,
    live: liveSlug.current === slug,
    status: status ?? "lobby",
    reasonKind: classifyResultReason(reason),
    reducedMotion,
  };
  const latest = useRef(input);
  latest.current = input;
  const immediate = resultGate({ ...input, sinceEndMs: 0, quietForMs: null }).show;
  const [readyFor, setReadyFor] = useState<string | null>(null);

  useEffect(() => {
    if (!over) {
      setReadyFor(null);
      return undefined;
    }
    if (immediate) return undefined;
    const startedAt = Date.now();
    let quietSince: number | null = null;
    const tick = () => {
      const now = Date.now();
      quietSince = boardQuietNow(board.current) ? (quietSince ?? now) : null;
      const decision = resultGate({
        ...latest.current,
        sinceEndMs: now - startedAt,
        quietForMs: quietSince == null ? null : now - quietSince,
      });
      if (!decision.show) return;
      window.clearInterval(timer);
      setReadyFor(slug);
    };
    const timer = window.setInterval(tick, RESULT_TIMING.tickMs);
    return () => window.clearInterval(timer);
  }, [over, immediate, slug, board]);

  return over && (immediate || readyFor === slug);
}
