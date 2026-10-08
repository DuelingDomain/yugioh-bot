import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { DURATION, EASE_OUT, inputWasKeyboard, prefersReducedMotion, trackInputModality } from "@/lib/motion";

/** Where the active mark sits, in the sidebar's own scroll space so scrolling is never a move. */
export type MarkSpot = { href: string; x: number; y: number };

/**
 * The offset to start the glide from, or null when there is nothing to play: a first mark, the same
 * item, or a move too small to see.
 */
export function planGlide(from: MarkSpot | null, to: MarkSpot): { dx: number; dy: number } | null {
  if (!from || from.href === to.href) return null;
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
  return { dx, dy };
}

function spotOf(root: HTMLElement, mark: HTMLElement, href: string): MarkSpot {
  const box = root.getBoundingClientRect();
  const rect = mark.getBoundingClientRect();
  return { href, x: rect.left - box.left + root.scrollLeft, y: rect.top - box.top + root.scrollTop };
}

/**
 * The active nav item's fill and bar are one `[data-glide]` mark that lives inside the active
 * item. When the active item changes, the new mark starts where the old one was and glides over
 * (FLIP, transform only, 200ms ease-out), so the highlight travels instead of jumping.
 *
 * It is a move you watch for, so it only plays for a pointer or touch: a keyboard choice, reduced
 * motion and the first mark are instant. A second change in flight starts from where the old mark
 * visibly was (read on pointerdown, before the click lands).
 */
export function useNavGlide(rootRef: RefObject<HTMLElement | null>, activeHref: string | null): void {
  const last = useRef<MarkSpot | null>(null);
  const running = useRef<Animation | null>(null);

  useEffect(() => {
    trackInputModality();
    const root = rootRef.current;
    if (!root) return;
    // Read the mark where it visibly is, still carrying any glide in flight, before a click changes it.
    const onDown = () => {
      const mark = root.querySelector<HTMLElement>("[data-glide]");
      if (mark) last.current = spotOf(root, mark, mark.dataset.glide ?? "");
    };
    root.addEventListener("pointerdown", onDown, true);
    return () => root.removeEventListener("pointerdown", onDown, true);
  }, [rootRef]);

  // No dependency list: the mark can also move with a layout change, and the check is cheap.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const mark = root?.querySelector<HTMLElement>("[data-glide]") ?? null;
    if (!root || !mark) {
      last.current = null;
      return;
    }
    const href = activeHref ?? "";
    // The same item: keep the record fresh, but not while a glide is moving the mark.
    if (last.current?.href === href) {
      if (!running.current) last.current = spotOf(root, mark, href);
      return;
    }
    const here = spotOf(root, mark, href);
    const move = planGlide(last.current, here);
    last.current = here;
    if (!move || prefersReducedMotion() || inputWasKeyboard() || typeof mark.animate !== "function") return;
    const animation = mark.animate(
      [{ transform: `translate(${move.dx}px, ${move.dy}px)` }, { transform: "none" }],
      { duration: DURATION.tab, easing: EASE_OUT },
    );
    running.current = animation;
    animation.onfinish = animation.oncancel = () => {
      if (running.current === animation) running.current = null;
    };
  });
}
