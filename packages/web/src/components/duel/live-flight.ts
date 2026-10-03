import { duelFxClock } from "./fx-clock";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { findMoveDestination, followMoveDestination, moveDestinationRect, moveDestinationRotation } from "./event-queue";

type Rect = ReturnType<typeof moveDestinationRect>;
type Offset = { dx: number; dy: number };
type Pose = Offset & { rotation: number };

/** Add a continuous correction to the authored arc, reaching the live engine slot at its deadline. */
export function retargetFlight({ event, el, overlay, cx, cy, duration, fallback, endRot = 0 }: {
  event: DuelEvent; el: HTMLElement; overlay: HTMLElement; cx: number; cy: number; duration: number;
  fallback?: () => Rect | undefined;
  endRot?: number;
}): { finish: () => Offset; stop: () => void } {
  const start = duelFxClock.now();
  const deadline = start + duration;
  let changedAt = start;
  let from: Pose = { dx: 0, dy: 0, rotation: 0 };
  let goal: Pose = { dx: 0, dy: 0, rotation: 0 };
  const read = (destination: HTMLElement | null) => {
    const rect = destination ? moveDestinationRect(destination) : fallback?.();
    const layer = overlay.getBoundingClientRect();
    return { now: duelFxClock.now(), target: rect ? {
      dx: rect.left - layer.left + rect.width / 2 - cx,
      dy: rect.top - layer.top + rect.height / 2 - cy,
      rotation: destination ? moveDestinationRotation(destination) - endRot : goal.rotation,
    } : goal };
  };
  const at = (now: number): Pose => {
    const progress = Math.min(1, Math.max(0, (now - changedAt) / Math.max(1, deadline - changedAt)));
    const blend = progress * progress * (3 - 2 * progress);
    return { dx: from.dx + (goal.dx - from.dx) * blend, dy: from.dy + (goal.dy - from.dy) * blend,
      rotation: from.rotation + (goal.rotation - from.rotation) * blend };
  };
  const write = ({ now, target }: ReturnType<typeof read>) => {
    const current = at(now);
    if (Math.hypot(target.dx - goal.dx, target.dy - goal.dy) > 0.01 || Math.abs(target.rotation - goal.rotation) > 0.001) {
      from = current;
      goal = target;
      changedAt = now;
    }
    const correction = at(now);
    el.style.translate = `${correction.dx}px ${correction.dy}px`;
    el.style.rotate = `${correction.rotation}deg`;
  };
  const stop = followMoveDestination(event, read, write);
  return {
    stop,
    finish: () => {
      // Timers may fire between rAFs. Flush the last geometry before revealing the real card.
      goal = read(findMoveDestination(event)).target;
      el.style.translate = `${goal.dx}px ${goal.dy}px`;
      el.style.rotate = `${goal.rotation}deg`;
      stop();
      return { dx: goal.dx, dy: goal.dy };
    },
  };
}
