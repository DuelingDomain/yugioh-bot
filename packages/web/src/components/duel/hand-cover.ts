import { useEffect } from "react";

/** A card of your own hand: the field hand wraps it in `data-hand-card`, the Tag hand is the button itself. */
const OWN_HAND_CARD = '[data-hand-seat][data-side="you"] :is([data-hand-card], button[data-zones])';
/** How far a hovered card is followed after the pointer leaves it: the card shrinks back over about half a second. */
const COVER_HOLD_MS = 700;
/** A layer may draw pills, a crown or a glow outside its box; a hole this near the box can still touch them. */
const COVER_REACH = 40;

/**
 * A hovered (or keyboard focused) card of your hand must lie over everything on the board so you can read all of it and click
 * it. The hand sits inside the board's own stacking contexts (different in every table shell), while the Deck Master emblem, the
 * chain badges and callout, the chain card ring and the equip links are layers above the whole board (some are portaled to the
 * page body or the duel root), so no z-index can lift the card over them. Instead such a layer gets a hole where the card is:
 * `--hand-cut` (a `clip-path`, `clip-path: var(--hand-cut, none)` on the layer) follows the card's real box every frame while it
 * grows and shrinks. A clip-path also removes the hole from hit testing, so the pointer there reaches the card, and the rest of
 * the layer stays whole. Field cards need no hole: the hand strip rises over them by CSS (`field.module.css`).
 */
export function useHandCover(wrap: { current: HTMLElement | null }, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let card: HTMLElement | null = null;
    let holdUntil = 0;
    let frame = 0;
    let shown = "";
    const set = (value: string) => {
      const el = wrap.current;
      if (!el || value === shown) return;
      shown = value;
      if (value) el.style.setProperty("--hand-cut", value);
      else el.style.removeProperty("--hand-cut");
    };
    const tick = () => {
      frame = 0;
      const el = wrap.current;
      if (!el || !card?.isConnected) {
        card = null;
        set("");
        return;
      }
      const box = el.getBoundingClientRect();
      const r = (card.querySelector<HTMLElement>("[data-card-frame]") ?? card).getBoundingClientRect();
      const near = r.right > box.left - COVER_REACH && r.left < box.right + COVER_REACH && r.bottom > box.top - COVER_REACH && r.top < box.bottom + COVER_REACH;
      if (near) {
        // A scaled layer (a camera zoom) draws its clip-path in its own, unscaled pixels.
        const scale = el.offsetWidth > 0 && Math.abs(box.width / el.offsetWidth - 1) > 0.01 ? box.width / el.offsetWidth : 1;
        const x1 = Math.round((r.left - box.left) / scale);
        const y1 = Math.round((r.top - box.top) / scale);
        const x2 = Math.round((r.right - box.left) / scale);
        const y2 = Math.round((r.bottom - box.top) / scale);
        set(`polygon(evenodd, -400px -400px, calc(100% + 400px) -400px, calc(100% + 400px) calc(100% + 400px), -400px calc(100% + 400px), -400px -400px, ${x1}px ${y1}px, ${x2}px ${y1}px, ${x2}px ${y2}px, ${x1}px ${y2}px, ${x1}px ${y1}px)`);
      } else set("");
      if (hovered(card) || performance.now() < holdUntil) frame = requestAnimationFrame(tick);
      else {
        card = null;
        set("");
      }
    };
    const hovered = (el: HTMLElement) => el.matches(":hover, :focus-visible, :has(:focus-visible)");
    const enter = (target: EventTarget | null) => {
      const hit = target instanceof Element ? target.closest<HTMLElement>(OWN_HAND_CARD) : null;
      if (!hit) return;
      card = hit.closest<HTMLElement>("[data-hand-card]") ?? hit;
      holdUntil = 0;
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const leave = () => {
      holdUntil = performance.now() + COVER_HOLD_MS;
    };
    const onOver = (e: Event) => enter(e.target);
    const onFocus = (e: Event) => enter(e.target);
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", leave, true);
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("focusout", leave, true);
    return () => {
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", leave, true);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("focusout", leave, true);
      if (frame) cancelAnimationFrame(frame);
      set("");
    };
  }, [wrap, enabled]);
}
