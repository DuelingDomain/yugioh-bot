"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import type { Motion } from "./use-animations";

export interface Moment {
  /** Changes for every new moment, so the same match never plays twice. */
  key: string;
  matchId: number;
  winnerId: number;
  /** The viewer played this match: the card leaves the centre of their field. */
  mine: boolean;
}

const WAIT = 360;
const LINE = 250;
const FLIGHT = 700;
const LAND = 220;
const CALM = 280;

type Anim = { cancel: () => void; finished?: Promise<unknown> };

function canAnimate(node: HTMLElement): boolean {
  return typeof node.animate === "function";
}

/**
 * When a series finishes, the winner's new locator card is hidden before the browser paints, then either
 * flies in from the score (Full), fades in where it lives (Calm), or simply shows (Off). Nothing here
 * renders: it works on the page's own DOM, finds the card by `data-slot="<winnerId>:<matchId>"`, and puts
 * everything back on cleanup. Only transform and opacity are animated.
 */
export function LocatorFly({ moment, motion, root }: { moment: Moment | null; motion: Motion; root: RefObject<HTMLElement | null> }) {
  const key = moment?.key ?? null;
  // Changing the level mid-flight must not replay the moment, so the effect reads it from a ref.
  const level = useRef(motion);
  useLayoutEffect(() => { level.current = motion; });
  useLayoutEffect(() => {
    const motion = level.current;
    if (!moment || motion === "off") return;
    if (typeof document !== "undefined" && document.hidden) return;
    const scope: ParentNode = root.current ?? document;
    const slot = scope.querySelector<HTMLElement>(`[data-slot="${moment.winnerId}:${moment.matchId}"]`);
    if (!slot) return;
    const source = moment.mine
      ? scope.querySelector<HTMLElement>('[data-fly-source="centre"]')
      : scope.querySelector<HTMLElement>(`[data-table-score="${moment.matchId}"]`);

    const running: Anim[] = [];
    let flyer: HTMLElement | null = null;
    let timer: number | null = null;
    let done = false;
    slot.style.opacity = "0";

    const restore = () => {
      if (done) return;
      done = true;
      if (timer !== null) window.clearTimeout(timer);
      flyer?.remove();
      slot.style.opacity = "";
    };

    if (!canAnimate(slot)) {
      // No animation support (old browsers, tests): the card simply shows.
      restore();
      return;
    }

    if (motion === "calm" || !source) {
      const fade = slot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CALM, easing: "ease-out" });
      running.push(fade);
      timer = window.setTimeout(restore, CALM + 40);
      return () => { running.forEach((a) => a.cancel()); restore(); };
    }

    const from = source.getBoundingClientRect();
    const to = slot.getBoundingClientRect();
    if (to.width === 0 || to.height === 0) { restore(); return; }
    const sx = from.left + from.width / 2;
    const sy = from.top + from.height / 2;
    const tx = to.left + to.width / 2;
    const ty = to.top + to.height / 2;
    const mx = (sx + tx) / 2;
    const my = (sy + ty) / 2 - 80;
    const at = (x: number, y: number, scale: string) => `translate(${x - to.width / 2}px, ${y - to.height / 2}px) scale(${scale})`;

    flyer = document.createElement("div");
    flyer.setAttribute("aria-hidden", "true");
    flyer.style.cssText =
      `position:fixed;left:0;top:0;z-index:70;pointer-events:none;width:${to.width}px;height:${to.height}px;` +
      "border-radius:5px;background:#2b2210;border:1px solid #e4b64f;box-shadow:0 0 18px 3px rgba(228,182,79,.5);will-change:transform,opacity;opacity:0";
    document.body.appendChild(flyer);

    const total = WAIT + LINE + FLIGHT;
    const o1 = WAIT / total;
    const o2 = (WAIT + LINE) / total;
    const o3 = (WAIT + LINE + FLIGHT * 0.5) / total;
    const flight = flyer.animate(
      [
        { offset: 0, opacity: 0, transform: at(sx, sy, "0.3, 0.02") },
        { offset: o1, opacity: 1, transform: at(sx, sy, "0.3, 0.02"), easing: "ease-out" },
        { offset: o2, opacity: 1, transform: at(sx, sy, "0.5, 0.5"), easing: "cubic-bezier(0.45, 0.05, 0.3, 1)" },
        { offset: o3, opacity: 1, transform: at(mx, my, "1.15"), easing: "cubic-bezier(0.45, 0.05, 0.3, 1)" },
        { offset: 1, opacity: 1, transform: at(tx, ty, "1") },
      ],
      { duration: total, fill: "forwards" },
    );
    running.push(flight);
    flight.onfinish = () => {
      slot.style.opacity = "";
      flyer?.remove();
      const pulse = slot.animate([{ transform: "scale(1.06)" }, { transform: "scale(1)" }], { duration: LAND, easing: "ease-out" });
      running.push(pulse);
      done = true;
    };
    // If the animation never reports back, do not leave the card hidden.
    timer = window.setTimeout(restore, total + 600);
    return () => { running.forEach((a) => a.cancel()); restore(); };
    // The moment is identified by its key; `moment` itself is a new object on every render of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
