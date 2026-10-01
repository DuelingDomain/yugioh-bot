/**
 * Slow motion for the FX lab. Lab only: nothing in the duel room imports this file.
 *
 * The effects run on several clocks: setTimeout and setInterval, performance.now and Date.now,
 * requestAnimationFrame stamps (the Three.js canvas), the Web Animations API (`element.animate`)
 * and CSS animations and transitions. The shim scales all of them by one factor:
 *
 *  - timers wait `delay / factor` in real time;
 *  - performance.now, Date.now and the rAF stamp run at `factor` times real speed, and stay
 *    continuous when the factor changes (no jump);
 *  - every animation gets `playbackRate = factor` (new WAAPI animations at creation, CSS ones when
 *    they start, and a short poll as a safety net).
 *
 * At factor 1 and before any change it is an identity. Not covered: audio (it plays at normal
 * speed), and timers that were already pending when the factor changed (they keep their delay).
 */

export type TimeShim = {
  /** Sets the speed: 1 = normal, 0.5 = half speed, 0.25 = quarter speed. */
  setFactor(factor: number): void;
  factor(): number;
  /** Timers that ignore the shim: the runner of the lab uses them for its own schedule. */
  realSetTimeout: (handler: () => void, ms: number) => number;
  realClearTimeout: (id: number) => void;
  uninstall(): void;
};

const KEY = "__fxLabTimeShim";

type Patched = Window & typeof globalThis & { [KEY]?: TimeShim };

export function installTimeShim(): TimeShim {
  const w = window as Patched;
  w[KEY]?.uninstall();

  const orig = {
    setTimeout: w.setTimeout.bind(w),
    clearTimeout: w.clearTimeout.bind(w),
    setInterval: w.setInterval.bind(w),
    rAF: w.requestAnimationFrame.bind(w),
    perfNow: performance.now.bind(performance),
    dateNow: Date.now.bind(Date),
    animate: Element.prototype.animate,
  };

  let f = 1;
  const perfOrigin = orig.perfNow();
  const dateOrigin = orig.dateNow();
  // virtual(t) = vBase + (t - rBase) * f, rebased on every change so the clock never jumps.
  let rBase = perfOrigin;
  let vBase = perfOrigin;

  const virtualOf = (realStamp: number) => vBase + (realStamp - rBase) * f;
  const virtualNow = () => virtualOf(orig.perfNow());

  const setAnimationRate = (animation: Animation) => {
    try {
      if (animation.playbackRate !== f) animation.playbackRate = f;
    } catch {
      // an animation that cannot change rate is left as it is
    }
  };
  const retime = (root: Document | Element) => {
    try {
      for (const animation of root.getAnimations()) setAnimationRate(animation);
    } catch {
      // getAnimations is missing in very old engines
    }
  };

  const onAnimationEvent = (event: Event) => {
    if (f === 1) return;
    const target = event.target;
    if (target instanceof Element) retime(target);
  };
  document.addEventListener("animationstart", onAnimationEvent, true);
  document.addEventListener("transitionrun", onAnimationEvent, true);
  const poll = orig.setInterval(() => {
    if (f !== 1) retime(document);
  }, 100);

  w.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
    typeof handler === "function" && f !== 1
      ? orig.setTimeout(handler, (delay ?? 0) / f, ...args)
      : orig.setTimeout(handler, delay, ...args)) as typeof w.setTimeout;
  w.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
    typeof handler === "function" && f !== 1
      ? orig.setInterval(handler, (delay ?? 0) / f, ...args)
      : orig.setInterval(handler, delay, ...args)) as typeof w.setInterval;
  w.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    orig.rAF((stamp) => callback(f === 1 && vBase === rBase ? stamp : virtualOf(stamp)))) as typeof w.requestAnimationFrame;
  performance.now = () => virtualNow();
  Date.now = () => Math.round(dateOrigin + (virtualNow() - perfOrigin));
  Element.prototype.animate = function patchedAnimate(this: Element, ...args: Parameters<Element["animate"]>) {
    const animation = orig.animate.apply(this, args);
    if (f !== 1) setAnimationRate(animation);
    return animation;
  };

  const shim: TimeShim = {
    setFactor(next) {
      const factor = Number.isFinite(next) && next > 0 ? next : 1;
      const now = orig.perfNow();
      vBase = virtualOf(now);
      rBase = now;
      f = factor;
      retime(document);
    },
    factor: () => f,
    realSetTimeout: (handler, ms) => orig.setTimeout(handler, ms),
    realClearTimeout: (id) => orig.clearTimeout(id),
    uninstall() {
      w.setTimeout = orig.setTimeout as typeof w.setTimeout;
      w.setInterval = orig.setInterval as typeof w.setInterval;
      w.requestAnimationFrame = orig.rAF as typeof w.requestAnimationFrame;
      performance.now = orig.perfNow;
      Date.now = orig.dateNow;
      Element.prototype.animate = orig.animate;
      document.removeEventListener("animationstart", onAnimationEvent, true);
      document.removeEventListener("transitionrun", onAnimationEvent, true);
      w.clearInterval(poll);
      f = 1;
      retime(document);
      if (w[KEY] === shim) delete w[KEY];
    },
  };
  w[KEY] = shim;
  return shim;
}
