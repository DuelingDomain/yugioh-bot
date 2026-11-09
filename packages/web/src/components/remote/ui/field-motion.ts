"use client";

import { useLayoutEffect, type RefObject } from "react";
import s from "./remote-ui.module.css";

/** The 1v1 board's easing and times (components/duel): fast out, settles softly. */
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const SLIDE_MS = 220, FLIP_MS = 200, REMOVE_MS = 150;
/** A card the player just dropped is already where it belongs: no slide for it. */
const DROP_MS = 3000;

/** What the field must know about its cards; the signature of these is what starts motion work. */
export interface MotionCard { ref: string; zone: string; slot?: number; faceUp: boolean; position?: string }
/** Only the cell, the pose and the elements are kept between pictures; positions are measured when a card moves. */
interface Seen { cell: string; up: boolean; def: boolean; els: HTMLElement[] }

const rectOf = (el: HTMLElement) => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });

/**
 * Motion for cards that change place on one field: they slide between zones (FLIP), turn over, go to the Graveyard or Banished pile and
 * fade out when they leave. Only `translate`, `rotate`, `opacity` and `scale` are animated, so there is no layout work.
 * Positions are layout offsets inside the field (a turned 180 degree field needs no extra maths), read only when the
 * set of cards changed, and only for the cells of cards that moved. Reduced motion and the first picture play nothing.
 */
export function useFieldMotion(root: RefObject<HTMLElement | null>, twin: readonly MotionCard[], dropped: RefObject<{ ref: string; at: number } | null>) {
  const signature = twin.map(card => `${card.ref}|${card.zone}|${card.slot ?? ""}|${card.faceUp ? 1 : 0}|${card.position ?? ""}`).join(";");
  useLayoutEffect(() => {
    const field = root.current; if (!field) return;
    const store = field as HTMLElement & { __seen?: Map<string, Seen> };
    const before = store.__seen; const now = new Map<string, Seen>(); const cells = new Map<string, HTMLElement>();
    for (const cell of field.querySelectorAll<HTMLElement>("[data-z]")) {
      cells.set(cell.dataset.z ?? "", cell);
      const ref = cell.dataset.ref; if (!ref) continue;
      now.set(ref, { cell: cell.dataset.z ?? "", up: cell.dataset.up === "1", def: cell.dataset.def === "1", els: Array.from(cell.children) as HTMLElement[] });
    }
    store.__seen = now;
    if (!before || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) || typeof Element.prototype.animate !== "function") return;
    const drop = dropped.current && Date.now() - dropped.current.at < DROP_MS ? dropped.current.ref : null;
    for (const [ref, to] of now) {
      const from = before.get(ref); if (!from || ref.startsWith("fw-")) continue;
      const moved = from.cell !== to.cell && ref !== drop, turned = from.up !== to.up;
      if (!moved && !turned) continue;
      const source = cells.get(from.cell), target = cells.get(to.cell); if (!target) continue;
      const frame: Keyframe = {};
      if (moved && source) { const a = rectOf(source), b = rectOf(target); frame.translate = `${a.x - b.x}px ${a.y - b.y}px`; }
      if (turned) frame.rotate = "y 90deg";
      if (!frame.translate && !frame.rotate) continue;
      for (const el of to.els) el.animate([frame, { translate: "0 0", rotate: "y 0deg" }], { duration: moved ? SLIDE_MS : FLIP_MS, easing: EASE });
    }
    for (const [ref, from] of before) {
      if (now.has(ref) || ref.startsWith("fw-")) continue;
      const source = cells.get(from.cell); if (!source) continue;
      const rect = rectOf(source);
      const dest = twin.find(card => card.ref === ref);
      const gy = dest?.zone === "graveyard" ? cells.get("gy") : dest?.zone === "banished" ? cells.get("ban") : null;
      // The old elements are out of the tree but intact: draw a copy of them where they were.
      const wrap = document.createElement("div");
      wrap.className = `${s.zc} ${from.def ? s.def : ""} ${s.leaving}`;
      Object.assign(wrap.style, { position: "absolute", left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px`, pointerEvents: "none", zIndex: "30", background: "none", border: "0" });
      wrap.setAttribute("aria-hidden", "true");
      for (const el of from.els) wrap.append(el.cloneNode(true));
      field.append(wrap);
      const done = () => wrap.remove();
      const keyframes: Keyframe[] = gy
        ? [{ translate: "0 0", opacity: 1 }, { translate: `${gy.offsetLeft - rect.x}px ${gy.offsetTop - rect.y}px`, opacity: 1 }]
        : [{ opacity: 1, scale: "1" }, { opacity: 0, scale: "0.85" }];
      const animation = wrap.animate(keyframes, { duration: gy ? SLIDE_MS : REMOVE_MS, easing: EASE, fill: "forwards" });
      animation.onfinish = done; animation.oncancel = done;
    }
  }, [signature, root, dropped]);
}
