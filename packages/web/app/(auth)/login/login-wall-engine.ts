// The motion of the card wall: the drift, the pick, the pointer lean. Only transform and opacity move.
// startWall returns one function that stops everything it started: timers, frames, listeners
// and animations. The component calls it before every rebuild and on unmount.

import {
  PARALLAX_LERP,
  PICK_MS,
  WALL_TILT,
  choosePick,
  parallaxTarget,
  pickDelay,
  pickTarget,
  railDuration,
  rampRate,
  type PickCandidate,
  type WallMode,
} from "./login-wall-model";

type Timer = ReturnType<typeof setTimeout>;

export type WallEngineOptions = {
  mode: WallMode;
  /** Columns per wall; the rails of a wall are its first element's first child's siblings. */
  sides: HTMLElement[];
  /** Bands that are drawn, top first. */
  bands: HTMLElement[];
  /** CSS module class names the engine adds. */
  classes: { pick: string; sheen: string };
  /** True when this is a rebuild after a resize: no wait, no slow ramp. */
  rebuild: boolean;
  /** Milliseconds since the page started loading (performance.now()). */
  sinceLoad: number;
};

function wallOf(el: HTMLElement): HTMLElement | null {
  return el.firstElementChild as HTMLElement | null;
}

export function startWall(options: WallEngineOptions): () => void {
  const { mode, classes, rebuild } = options;
  const walls = mode === "walls";
  const targets = (walls ? options.sides : options.bands).filter((el) => wallOf(el)?.firstElementChild);
  if (targets.length === 0) return () => {};

  const timers = new Set<Timer>();
  const animations: Animation[] = [];
  let rampFrame = 0;
  let parallaxFrame = 0;
  let pickTimer: Timer | null = null;
  let picking: { card: HTMLElement; sheen: HTMLElement; timer: Timer } | null = null;
  let pickCount = 0;
  let stopped = false;

  const after = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };

  // The drift. Each rail holds the same cards twice, so moving by exactly half repeats with no seam.
  // It starts at rate 0 and eases up, so it never competes with the centre's entrance.
  targets.forEach((el, wallIndex) => {
    const wall = wallOf(el);
    if (!wall) return;
    Array.from(wall.children).forEach((rail, column) => {
      if (typeof (rail as HTMLElement).animate !== "function") return;
      const n = Number((rail as HTMLElement).dataset.n) || 8;
      const axis = walls ? "translate3d(0, %, 0)" : "translate3d(%, 0, 0)";
      const animation = (rail as HTMLElement).animate(
        [{ transform: axis.replace("%", "0") }, { transform: axis.replace("%", "-50%") }],
        { duration: railDuration(mode, column, n), iterations: Infinity, easing: "linear", direction: wallIndex ? "reverse" : "normal" },
      );
      animation.playbackRate = 0;
      animations.push(animation);
    });
  });

  const ramp = (ms: number) => {
    const t0 = performance.now();
    const tick = (now: number) => {
      if (stopped) return;
      const t = Math.min(1, (now - t0) / ms);
      const rate = rampRate(t);
      if (!document.hidden) animations.forEach((a) => { a.playbackRate = rate; });
      if (t < 1) rampFrame = requestAnimationFrame(tick);
    };
    rampFrame = requestAnimationFrame(tick);
  };
  after(() => ramp(rebuild ? 1 : 1700), rebuild ? 0 : Math.max(0, 1100 - options.sinceLoad));

  // The pick: one card near the middle of the outer rail turns to face you, catches the light, goes back.
  const endPick = () => {
    if (!picking) return;
    clearTimeout(picking.timer);
    timers.delete(picking.timer);
    picking.card.classList.remove(classes.pick);
    picking.sheen.remove();
    picking = null;
  };

  const doPick = () => {
    if (picking || document.hidden) return;
    const index = pickTarget(targets.length, pickCount);
    pickCount += 1;
    const wall = index >= 0 ? wallOf(targets[index]) : null;
    const rail = wall?.firstElementChild;
    if (!rail) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const candidates = Array.from(rail.children).map((child) => {
      const card = child as HTMLElement;
      const rect = card.getBoundingClientRect();
      const centre = walls ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
      return { id: Number(card.dataset.card), centre, card } satisfies PickCandidate & { card: HTMLElement };
    });
    const chosen = choosePick(candidates, mode, viewport, Math.random());
    if (!chosen) return;
    const sheen = document.createElement("i");
    sheen.className = classes.sheen;
    chosen.card.firstElementChild?.appendChild(sheen);
    chosen.card.classList.add(classes.pick);
    const timer = after(endPick, PICK_MS + 60);
    picking = { card: chosen.card, sheen, timer };
  };

  const schedulePick = (first: boolean, delayOverride?: number) => {
    if (pickTimer) { clearTimeout(pickTimer); timers.delete(pickTimer); }
    const delay = delayOverride ?? pickDelay(mode, first, options.sinceLoad, Math.random());
    pickTimer = after(() => {
      pickTimer = null;
      doPick();
      schedulePick(false);
    }, delay);
  };
  schedulePick(!rebuild, rebuild ? 2200 : undefined);

  // Pointer parallax, only with a mouse: the walls lean a few pixels against the pointer, smoothed.
  const cleanups: Array<() => void> = [];
  const fineHover = typeof window.matchMedia === "function" ? window.matchMedia("(hover: hover) and (pointer: fine)") : null;
  if (walls && fineHover) {
    const cur = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };
    const wallEls = options.sides.map(wallOf);
    const step = () => {
      parallaxFrame = 0;
      cur.x += (target.x - cur.x) * PARALLAX_LERP;
      cur.y += (target.y - cur.y) * PARALLAX_LERP;
      wallEls.forEach((wall, i) => {
        if (wall) wall.style.transform = `translate3d(${cur.x.toFixed(2)}px, ${cur.y.toFixed(2)}px, 0) rotateY(${i ? -WALL_TILT : WALL_TILT}deg)`;
      });
      if (Math.abs(target.x - cur.x) > 0.04 || Math.abs(target.y - cur.y) > 0.04) parallaxFrame = requestAnimationFrame(step);
    };
    const onMove = (event: PointerEvent) => {
      if (!fineHover.matches || document.hidden) return;
      const next = parallaxTarget(event.clientX, event.clientY, window.innerWidth, window.innerHeight);
      target.x = next.x;
      target.y = next.y;
      if (!parallaxFrame) parallaxFrame = requestAnimationFrame(step);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    cleanups.push(() => {
      window.removeEventListener("pointermove", onMove);
      wallEls.forEach((wall) => { if (wall) wall.style.transform = ""; });
    });
  }

  // A hidden tab runs nothing: the drift pauses and the pick timer is cleared. Both resume when it is visible.
  const onVisibility = () => {
    if (document.hidden) {
      animations.forEach((a) => a.pause());
      if (pickTimer) { clearTimeout(pickTimer); timers.delete(pickTimer); pickTimer = null; }
    } else {
      animations.forEach((a) => a.play());
      schedulePick(false, 2000);
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));

  return () => {
    stopped = true;
    cancelAnimationFrame(rampFrame);
    cancelAnimationFrame(parallaxFrame);
    timers.forEach(clearTimeout);
    timers.clear();
    endPick();
    cleanups.forEach((fn) => fn());
    animations.forEach((a) => a.cancel());
    animations.length = 0;
  };
}
