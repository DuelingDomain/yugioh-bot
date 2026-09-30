/**
 * Keyframe offsets must be in [0, 1] and never go down, or `Element.animate` throws. Timings in the
 * duel effects are computed (break times, holds, scaled tracks), so an edge case can break that
 * rule. Clamps each offset into [prev, 1] and drops offsets that are not numbers.
 */
export function sanitizeKeyframes(frames: Keyframe[]): Keyframe[] {
  let floor = 0;
  let changed = false;
  const out = frames.map((frame) => {
    const offset = frame.offset;
    if (offset == null) return frame;
    if (typeof offset !== "number" || !Number.isFinite(offset)) {
      changed = true;
      const { offset: _dropped, ...rest } = frame;
      return rest;
    }
    const safe = Math.min(1, Math.max(floor, offset));
    floor = safe;
    if (safe === offset) return frame;
    changed = true;
    return { ...frame, offset: safe };
  });
  return changed ? out : frames;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * `el.animate` that never throws: a bad keyframe or timing from an effect skips that one animation
 * instead of crashing the duel room.
 */
export function safeAnimate(el: Element, frames: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (typeof el.animate !== "function") return null;
  const timing: KeyframeAnimationOptions = { ...options };
  if (options.delay !== undefined) timing.delay = finiteOr(options.delay, 0);
  if (typeof options.duration === "number") timing.duration = Math.max(0, finiteOr(options.duration, 0));
  try {
    return el.animate(sanitizeKeyframes(frames), timing);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.warn("[duel fx] animation skipped", error);
    return null;
  }
}
