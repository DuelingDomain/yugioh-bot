import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { DURATION, EASE_OUT, prefersReducedMotion } from "@/lib/motion";

/** Pixels the new page travels. Forward navigation rises into place, back falls into place. */
export const PAGE_RISE = 6;

/** A back navigation counts for this long; after that the popstate is considered stale. */
const POP_WINDOW_MS = 3000;

export type PageDirection = "forward" | "back";

function decoded(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

/**
 * Fades the new page in with a 6px rise (a fall when the browser went back), once per pathname
 * change. Enter only: an exit fade would delay the route change. Plays on the element itself with
 * WAAPI, so nothing remounts and no transform is left behind when it ends (a leftover transform
 * would trap `position: fixed` children).
 *
 * Pass the shell's content element and the pathname. Search params must not be part of the key:
 * changing `?tab=` is not a page change. The first render never animates. A new navigation cancels
 * the running animation and starts from the opacity and offset it had reached. Reduced motion is a
 * short opacity fade with no movement.
 */
export function playPageEnter(
  el: HTMLElement,
  direction: PageDirection,
  previous?: Animation | null,
  reduced: boolean = prefersReducedMotion(),
): Animation | null {
  if (typeof el.animate !== "function") return null;

  let fromOpacity = 0;
  let fromY = direction === "back" ? -PAGE_RISE : PAGE_RISE;
  if (previous && previous.playState === "running") {
    // Interrupted: start from where the last one had got to, so rapid clicks never flash.
    const style = getComputedStyle(el);
    const opacity = parseFloat(style.opacity);
    if (Number.isFinite(opacity)) fromOpacity = Math.min(opacity, 1);
    try {
      if (typeof DOMMatrix === "function" && style.transform && style.transform !== "none") fromY = new DOMMatrix(style.transform).m42;
    } catch {
      // keep the default offset
    }
  }
  previous?.cancel();

  const keyframes: Keyframe[] = reduced
    ? [{ opacity: fromOpacity }, { opacity: 1 }]
    : [{ opacity: fromOpacity, transform: `translateY(${fromY}px)` }, { opacity: 1, transform: "translateY(0)" }];
  return el.animate(keyframes, {
    duration: reduced ? DURATION.reduced : DURATION.pageIn,
    easing: EASE_OUT,
    // No forward fill: when it ends the element has no transform at all.
    fill: "backwards",
  });
}

export function usePageEnter(ref: RefObject<HTMLElement | null>, pathname: string): void {
  const last = useRef(pathname);
  const popAt = useRef<number | null>(null);
  const animation = useRef<Animation | null>(null);

  // The browser's back button (and forward). The listener runs in capture on window, before Next's
  // own, so the flag is set before the pathname changes. A popstate that stays on the same pathname
  // (a query or hash change) is not a page change and must not tilt the next navigation.
  useEffect(() => {
    const onPop = () => {
      if (decoded(window.location.pathname) === decoded(last.current)) return;
      popAt.current = Date.now();
    };
    window.addEventListener("popstate", onPop, true);
    return () => window.removeEventListener("popstate", onPop, true);
  }, []);

  useLayoutEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    const popped = popAt.current;
    popAt.current = null;
    const el = ref.current;
    if (!el) return;
    const direction: PageDirection = popped !== null && Date.now() - popped < POP_WINDOW_MS ? "back" : "forward";
    animation.current = playPageEnter(el, direction, animation.current);
  }, [pathname, ref]);
}
