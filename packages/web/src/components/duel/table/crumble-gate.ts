import { isCoinTossActive } from "../coin-toss-lock";
import { GATE_TIMING } from "../duel-timing";
import { duelFxClock } from "../fx-clock";
import { lpMotionRemainingMs } from "../lp-motion";
import { movesSettleAt } from "../move-plan";
import { pendingBoardAnimations, promptRevealHoldMs, type AnimationLike } from "../prompt-reveal";

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

/* ---------- the regroup waits for the crumble ---------- */

type Listener = () => void;
const listeners = new Set<Listener>();
let waiting = 0;

/** A crumble that waits for the battle is on the board. */
export function crumbleWaiting(): boolean {
  return waiting > 0;
}

/**
 * A crumble starts to wait. The returned function says it starts (or that its seat is gone): whatever waited for it (the
 * regroup glide of the seats that stay, the finale board) may go on. It does its work once.
 */
export function beginCrumbleWait(): () => void {
  waiting += 1;
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    waiting -= 1;
    for (const listener of [...listeners]) listener();
  };
}

/** Calls `listener` each time a crumble that waited starts. */
export function onCrumbleStart(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type Pausable = AnimationLike & { pause(): void; play(): void; currentTime?: number | string | null };

const isCssTransition = (animation: unknown): boolean => (animation as { constructor?: { name?: string } }).constructor?.name === "CSSTransition";

/**
 * The seats that stay glide to their new places with a CSS transition whose delay is the crumble and the beat after it
 * (rival-field.module.css). That delay counts from the moment the seat left, so a crumble that waits for the battle would
 * run into the glide. While the crumble waits, the transitions that are still in their delay are paused; `resume`
 * lets them go on, so the glide starts a crumble and a beat after the crumble starts, as without the wait.
 */
export function pauseRegroup(source: { getAnimations(options?: { subtree?: boolean }): AnimationLike[] } | null | undefined = typeof document === "undefined" ? null : document): () => void {
  if (!source || typeof source.getAnimations !== "function") return () => undefined;
  const held: Pausable[] = [];
  for (const animation of source.getAnimations({ subtree: true }) as Pausable[]) {
    if (!isCssTransition(animation) || animation.playState === "finished" || animation.playState === "idle") continue;
    const timing = (animation.effect as { getTiming?: () => { delay?: number } } | null | undefined)?.getTiming?.();
    const delay = timing?.delay ?? 0;
    const at = typeof animation.currentTime === "number" ? animation.currentTime : 0;
    if (delay > 0 && at < delay) {
      animation.pause();
      held.push(animation);
    }
  }
  return () => {
    for (const animation of held) {
      try {
        if (animation.playState === "paused") animation.play();
      } catch {
        // The transition was cancelled while it waited.
      }
    }
  };
}
