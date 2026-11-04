"use client";

import { useLayoutEffect, type RefObject } from "react";
import s from "./remote-ui.module.css";

/** The 1v1 board's easing and times (components/duel): fast out, settles softly. */
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const SLIDE_MS = 220, FLIP_MS = 200, REMOVE_MS = 150;

interface Seen { cell: string; x: number; y: number; w: number; h: number; up: boolean; def: boolean; el: HTMLElement }
type Where = { zone: string; faceUp: boolean };

/**
 * Motion for cards that change place on one field: they slide between zones (FLIP), turn over, go to the Graveyard and
 * fade out when they leave. Only `translate`, `rotate`, `opacity` and `scale` are animated, so there is no layout work.
 * Positions come from layout offsets inside the field, so a turned (180 degree) field needs no extra maths.
 * Motion is skipped for reduced motion and for the first picture of a field.
 */
export function useFieldMotion(root: RefObject<HTMLElement | null>, where: ReadonlyMap<string, Where>) {
  useLayoutEffect(() => {
    const field = root.current; if (!field) return;
    const store = (field as HTMLElement & { __seen?: Map<string, Seen> });
    const before = store.__seen; const now = new Map<string, Seen>();
    for (const cell of field.querySelectorAll<HTMLElement>("[data-ref]")) {
      const ref = cell.dataset.ref!, el = cell.firstElementChild as HTMLElement | null; if (!el) continue;
      now.set(ref, { cell: cell.dataset.z ?? "", x: cell.offsetLeft, y: cell.offsetTop, w: cell.offsetWidth, h: cell.offsetHeight, up: cell.dataset.up === "1", def: cell.dataset.def === "1", el });
    }
    store.__seen = now;
    if (!before || typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof Element.prototype.animate !== "function") return;
    for (const [ref, to] of now) {
      const from = before.get(ref); if (!from || ref.startsWith("fw-")) continue;
      const moved = from.cell !== to.cell, turned = from.up !== to.up;
      if (!moved && !turned) continue;
      const frame: Keyframe = {};
      if (moved) frame.translate = `${from.x - to.x}px ${from.y - to.y}px`;
      if (turned) frame.rotate = "y 90deg";
      to.el.animate([frame, { translate: "0 0", rotate: "y 0deg" }], { duration: moved ? SLIDE_MS : FLIP_MS, easing: EASE });
    }
    for (const [ref, from] of before) {
      if (now.has(ref) || ref.startsWith("fw-")) continue;
      const dest = where.get(ref);
      const gy = dest?.zone === "graveyard" ? field.querySelector<HTMLElement>('[data-z="gy"]') : null;
      // The old card element is out of the tree but intact: draw a copy of it where it was.
      const wrap = document.createElement("div");
      wrap.className = `${s.zc} ${from.def ? s.def : ""} ${s.leaving}`;
      Object.assign(wrap.style, { position: "absolute", left: `${from.x}px`, top: `${from.y}px`, width: `${from.w}px`, height: `${from.h}px`, pointerEvents: "none", zIndex: "30", background: "none", border: "0" });
      wrap.setAttribute("aria-hidden", "true");
      wrap.append(from.el.cloneNode(true));
      field.append(wrap);
      const done = () => wrap.remove();
      const keyframes: Keyframe[] = gy
        ? [{ translate: "0 0", opacity: 1 }, { translate: `${gy.offsetLeft - from.x}px ${gy.offsetTop - from.y}px`, opacity: 1 }]
        : [{ opacity: 1, scale: "1" }, { opacity: 0, scale: "0.85" }];
      const animation = wrap.animate(keyframes, { duration: gy ? SLIDE_MS : REMOVE_MS, easing: EASE, fill: "forwards" });
      animation.onfinish = done; animation.oncancel = done;
    }
  });
}
