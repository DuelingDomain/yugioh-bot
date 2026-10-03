import { getAnimationSpeed } from "./animation-speed";

/**
 * The lab's continuous virtual-clock model, scoped to duel presentation. Browser clocks and timers
 * are never patched. Timers, rAF, DOM/CSS animations, canvas effects, audio and gates share this clock.
 * A requested speed is captured after the current effects/holds finish; pending work keeps its pace.
 */
export function createDuelFxClock(preference = getAnimationSpeed, realNow = () => performance.now()) {
  let rate = 1;
  let previousRate = 1;
  let lastFrame = 0;
  let reduced = false;
  let reviewSpeed: number | null = null;
  let realBase = 0;
  let virtualBase = 0;
  let lastReal = 0;
  const leases = new Map<object, number>();
  const rateListeners = new Set<(rate: number) => void>();

  const sync = () => {
    const real = realNow();
    // Also supports test clocks and a fresh browser performance time origin.
    if (real < lastReal) { leases.clear(); realBase = virtualBase = lastFrame = real; rate = previousRate = 1; }
    lastReal = real;
    for (const [key, until] of leases) if (until <= real) leases.delete(key);
    const wanted = reduced ? 1 : reviewSpeed ?? preference();
    if (leases.size === 0 && wanted !== rate) {
      virtualBase += (real - realBase) * rate;
      realBase = real;
      previousRate = rate;
      rate = wanted;
      for (const listener of rateListeners) listener(rate);
    }
    return real;
  };
  const now = () => { const real = sync(); return virtualBase + (real - realBase) * rate; };
  const factor = () => { sync(); return rate; };
  const realMs = (ms: number) => ms / factor();
  const retain = (ms: number) => {
    const real = sync();
    const key = {};
    if (Number.isFinite(ms) && ms > 0) leases.set(key, real + ms / rate);
    return () => { leases.delete(key); sync(); };
  };
  type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
  const timers = new Map<number, { release: () => void; handle: TimerHandle }>();
  let timerId = 0;
  const setTimeout = (fn: () => void, ms = 0): number => {
    const delay = Math.max(0, ms);
    const wait = realMs(delay);
    const release = retain(delay);
    const id = ++timerId;
    const handle = globalThis.setTimeout(() => { release(); timers.delete(id); fn(); }, wait);
    timers.set(id, { release, handle });
    return id;
  };
  const clearTimeout = (id: number | undefined) => {
    if (id == null) return;
    const timer = timers.get(id);
    if (!timer) return;
    timer.release(); timers.delete(id);
    globalThis.clearTimeout(timer.handle);
  };
  const intervals = new Map<number, TimerHandle>();
  let intervalId = 0;
  const setInterval = (fn: () => void, ms: number): number => {
    const id = ++intervalId;
    const tick = () => {
      if (!intervals.has(id)) return;
      fn();
      if (intervals.has(id)) intervals.set(id, globalThis.setTimeout(tick, realMs(ms)));
    };
    intervals.set(id, globalThis.setTimeout(tick, realMs(ms)));
    return id;
  };
  const clearInterval = (id: number) => {
    const timer = intervals.get(id);
    if (timer != null) globalThis.clearTimeout(timer);
    intervals.delete(id);
  };
  const rateAnimation = (animation: Animation | null, ms: number): Animation | null => {
    if (!animation) return null;
    const speed = factor();
    const release = retain(ms);
    try { animation.playbackRate = speed; } catch { /* Old engines can keep the fallback timer. */ }
    void animation.finished?.then(release, release);
    return animation;
  };
  const animate = (el: Element, frames: Keyframe[], options: KeyframeAnimationOptions): Animation => {
    const anim = el.animate(frames, options);
    const ms = Number(options.delay ?? 0) + Number(options.duration ?? 0) * Number(options.iterations ?? 1) + Number(options.endDelay ?? 0);
    rateAnimation(anim, ms);
    return anim;
  };
  return {
    now, factor, realMs, retain, animate,
    subscribeRate: (listener: (rate: number) => void) => { rateListeners.add(listener); return () => { rateListeners.delete(listener); }; }, rateAnimation, setTimeout, clearTimeout, setInterval, clearInterval,
    dateNow: () => {
      const real = sync();
      return Date.now() + virtualBase + (real - realBase) * rate - real;
    },
    requestAnimationFrame: (fn: FrameRequestCallback): number => window.requestAnimationFrame((stamp) => {
      sync();
      // The frame stamp precedes callback work. Convert a pre-rebase stamp at its old rate.
      lastFrame = Math.max(lastFrame, virtualBase + (stamp - realBase) * (stamp < realBase ? previousRate : rate));
      fn(lastFrame);
    }),
    cancelAnimationFrame: (id: number) => window.cancelAnimationFrame(id),
    setReducedMotion: (value: boolean) => { reduced = value; },
    /** Lab-only override, also allowing quarter-speed review. Room preferences remain untouched. */
    setReviewSpeed: (value: number | null) => { reviewSpeed = value != null && Number.isFinite(value) && value > 0 ? value : null; },
    /** Only after the lab remount has disposed every old layer and its holds. */
    resetReviewTimeline: () => {
      leases.clear();
      realBase = virtualBase = lastReal = realNow();
      lastFrame = realBase;
      rate = reduced ? 1 : reviewSpeed ?? preference();
      previousRate = rate;
      for (const listener of rateListeners) listener(rate);
    },
  };
}

export const duelFxClock = createDuelFxClock();
