import { isCoinTossActive } from "../coin-toss-lock";
import { GATE_TIMING } from "../duel-timing";
import { duelFxClock } from "../fx-clock";
import { lpMotionRemainingMs } from "../lp-motion";
import { movesSettleAt } from "../move-plan";
import { pendingBoardAnimations, promptRevealHoldMs } from "../prompt-reveal";

/**
 * When the crumble of a seat that left may start: the attack, the damage and the LP roll that put it out are over.
 * It is the rule that holds the result screen (result-reveal.ts `boardQuietNow`): no running script animation, no
 * card flight, no LP counter rolling, no coin toss. The crumble of another seat (`[data-seat-exit]`) does not count,
 * so two seats that leave in one batch crumble together instead of one after the other.
 */

/** How often the crumble looks at the board (the result gate's tick). */
export const CRUMBLE_GATE_TICK_MS = 100;

/** The crumble starts at the latest this long after the seat left, whatever the board does (the result gate's cap). */
export const CRUMBLE_GATE_CAP_MS = GATE_TIMING.resultCapMs;

type Target = { closest?: (selector: string) => unknown } | null | undefined;
type BoardSource = Parameters<typeof pendingBoardAnimations>[0];

export function crumbleMayStart(source: BoardSource = typeof document === "undefined" ? null : document): boolean {
  if (isCoinTossActive()) return false;
  const busy = pendingBoardAnimations(source).some((animation) => {
    const target = (animation.effect as { target?: Target } | null | undefined)?.target;
    return !target?.closest?.("[data-seat-exit]");
  });
  if (busy) return false;
  const stamp = typeof performance !== "undefined" ? duelFxClock.now() : duelFxClock.dateNow();
  return promptRevealHoldMs() <= 0 && lpMotionRemainingMs() <= 0 && movesSettleAt(stamp) <= stamp;
}

/* ---------- the caption and the out clock wait for the crumble ---------- */

type Listener = () => void;
const listeners = new Set<Listener>();
let waiting = 0;
let notifyQueued = false;

/** A crumble that waits for the battle is on the board. */
export function crumbleWaiting(): boolean {
  return waiting > 0;
}

const notify = () => {
  for (const listener of [...listeners]) listener();
};

/** A crumble that waits is a function: call it when the crumble starts. `drop` is for a seat that goes while it waits. */
export type CrumbleWait = (() => void) & { drop(): void };

/**
 * A crumble starts to wait. Calling the returned function says the crumble starts: whatever waited for it (the FINAL DUEL
 * caption, the out clock of the cell) hears it when no other crumble waits any more.
 * `drop` is for a seat that goes while it waits (an unmount, or the cleanup of a StrictMode double effect): it tells the
 * listeners in a microtask, and only if no crumble waits by then, so a remount does not release the caption early.
 * Each does its work once.
 */
export function beginCrumbleWait(): CrumbleWait {
  waiting += 1;
  let open = true;
  const leave = () => {
    if (!open) return false;
    open = false;
    waiting -= 1;
    return true;
  };
  const end = (() => {
    if (leave() && waiting === 0) notify();
  }) as CrumbleWait;
  end.drop = () => {
    if (!leave() || notifyQueued) return;
    notifyQueued = true;
    queueMicrotask(() => {
      notifyQueued = false;
      if (waiting === 0) notify();
    });
  };
  return end;
}

/** Calls `listener` each time a crumble that waited starts. */
export function onCrumbleStart(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
