import type { DuelEvent } from "@yugidraft/shared/duels";
import { findMoveDestination, followMoveDestination, moveDestinationRect } from "./event-queue";

type Rect = ReturnType<typeof moveDestinationRect>;
type Offset = { dx: number; dy: number };

/** Add a continuous correction to the authored arc, reaching the live engine slot at its deadline. */
export function retargetFlight({ event, el, overlay, cx, cy, duration, fallback }: {
  event: DuelEvent; el: HTMLElement; overlay: HTMLElement; cx: number; cy: number; duration: number;
  fallback?: () => Rect | undefined;
}): { finish: () => Offset; stop: () => void } {
  const start = performance.now();
  const deadline = start + duration;
  let changedAt = start;
  let from: Offset = { dx: 0, dy: 0 };
  let goal: Offset = { dx: 0, dy: 0 };
  const read = (destination: HTMLElement | null) => {
    const rect = destination ? moveDestinationRect(destination) : fallback?.();
    const layer = overlay.getBoundingClientRect();
    return { now: performance.now(), target: rect ? {
      dx: rect.left - layer.left + rect.width / 2 - cx,
      dy: rect.top - layer.top + rect.height / 2 - cy,
    } : goal };
  };
  const at = (now: number): Offset => {
    const progress = Math.min(1, Math.max(0, (now - changedAt) / Math.max(1, deadline - changedAt)));
    const blend = progress * progress * (3 - 2 * progress);
    return { dx: from.dx + (goal.dx - from.dx) * blend, dy: from.dy + (goal.dy - from.dy) * blend };
  };
  const write = ({ now, target }: ReturnType<typeof read>) => {
    const current = at(now);
    if (Math.hypot(target.dx - goal.dx, target.dy - goal.dy) > 0.01) {
      from = current;
      goal = target;
      changedAt = now;
    }
    const correction = at(now);
    el.style.translate = `${correction.dx}px ${correction.dy}px`;
  };
  const stop = followMoveDestination(event, read, write);
  return {
    stop,
    finish: () => {
      // Timers may fire between rAFs. Flush the last geometry before revealing the real card.
      goal = read(findMoveDestination(event)).target;
      el.style.translate = `${goal.dx}px ${goal.dy}px`;
      stop();
      return goal;
    },
  };
}
