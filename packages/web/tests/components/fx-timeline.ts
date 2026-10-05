import { vi } from "vitest";

/**
 * A jsdom stand-in for the Web Animations clock. `animate` records every animation with the fake time it began,
 * and `opacityAt` reads back what a viewer would see at a later fake time (keyframes, delay and fill, no easing).
 * With it a test can ask "what is on screen at +700 ms" without a browser.
 */
type Recorded = { el: Element; frames: Keyframe[]; options: KeyframeAnimationOptions; start: number };

export function createTimeline() {
  const animations: Recorded[] = [];
  const animate = vi.fn(function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
    animations.push({ el: this, frames, options: options ?? {}, start: performance.now() });
    return { finished: new Promise(() => {}), cancel: vi.fn(), effect: { getTiming: () => options }, currentTime: 0, playbackRate: 1 } as unknown as Animation;
  });

  const offsets = (frames: Keyframe[]): number[] => {
    const out = frames.map((frame) => (typeof frame.offset === "number" ? frame.offset : NaN));
    if (Number.isNaN(out[0])) out[0] = 0;
    if (Number.isNaN(out[out.length - 1])) out[out.length - 1] = 1;
    for (let i = 1; i < out.length; i += 1) {
      if (!Number.isNaN(out[i])) continue;
      let j = i;
      while (Number.isNaN(out[j])) j += 1;
      for (let k = i; k < j; k += 1) out[k] = out[i - 1] + ((out[j] - out[i - 1]) * (k - i + 1)) / (j - i + 1);
    }
    return out;
  };

  const sampleOpacity = (anim: Recorded, now: number): number | null => {
    const has = anim.frames.map((frame) => frame.opacity != null);
    if (!has.some(Boolean)) return null;
    const at = offsets(anim.frames);
    const points = anim.frames.map((frame, i) => ({ o: at[i], v: Number(frame.opacity) })).filter((_, i) => has[i]);
    const delay = Number(anim.options.delay ?? 0);
    const duration = Number(anim.options.duration ?? 0);
    const fill = anim.options.fill ?? "none";
    const local = now - anim.start - delay;
    if (local < 0) return fill === "backwards" || fill === "both" ? points[0].v : null;
    if (local >= duration) return fill === "forwards" || fill === "both" ? points[points.length - 1].v : null;
    const p = local / duration;
    for (let i = 1; i < points.length; i += 1) {
      if (p <= points[i].o) {
        const span = points[i].o - points[i - 1].o;
        return span <= 0 ? points[i].v : points[i - 1].v + ((points[i].v - points[i - 1].v) * (p - points[i - 1].o)) / span;
      }
    }
    return points[points.length - 1].v;
  };

  /** Opacity of one element: its own animation if one covers `now`, otherwise its inline style. */
  const own = (el: Element, now: number): number => {
    let value: number | null = null;
    for (const anim of animations) {
      if (anim.el !== el) continue;
      const sample = sampleOpacity(anim, now);
      if (sample != null) value = sample;
    }
    if (value != null) return value;
    const style = (el as HTMLElement).style;
    return style?.opacity ? Number(style.opacity) : 1;
  };

  /** What shows: the product of the opacities up to `root`, 0 when hidden or not displayed on the way. */
  const opacityAt = (el: Element, root: Element, now = performance.now()): number => {
    let total = 1;
    for (let node: Element | null = el; node && node !== root.parentElement; node = node.parentElement) {
      const style = (node as HTMLElement).style;
      if (style?.visibility === "hidden" || style?.display === "none") return 0;
      total *= own(node, now);
    }
    return total;
  };

  return { animate, animations, opacityAt };
}
export type Timeline = ReturnType<typeof createTimeline>;
