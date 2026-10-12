"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { hits, type Rect } from "./rect-util";

/** The air kept between a prompt and the HUD it steps aside from (px). */
const DODGE_AIR = 12;
/** The furthest a prompt leaves the middle row for the HUD (px): a panel that needs more stays in the middle and covers it. */
export const DODGE_MAX = 96;

/**
 * How far (px, positive = down) a prompt that is centred on the screen moves up or down to clear the HUD it would cover (the chips of the
 * phase hub). `panel` is the prompt at no shift. It never moves sideways: the prompt stays centred across the table. The shift is the
 * shortest one that clears every block it touches, keeps the panel inside the box and is at most DODGE_MAX; 0 when it touches none, or
 * when no such shift exists (the prompt then stays in the middle and covers the hub, which takes no click during a prompt).
 */
export function dodgeShift(panel: Rect, blocks: readonly Rect[], box: { width: number; height: number }, edge: number = DODGE_AIR): number {
  const touched = blocks.filter((block) => block.width > 1 && block.height > 1 && hits(panel, block));
  if (touched.length === 0) return 0;
  const inside = (shift: number) => panel.y + shift >= edge && panel.y + shift + panel.height <= box.height - edge;
  const clear = (shift: number) => blocks.every((block) => !hits({ ...panel, y: panel.y + shift }, block));
  const candidates = touched
    .flatMap((block) => [block.y + block.height + DODGE_AIR - panel.y, block.y - DODGE_AIR - panel.height - panel.y])
    .filter((shift) => Math.abs(shift) <= DODGE_MAX && inside(shift) && clear(shift))
    .sort((a, b) => Math.abs(a) - Math.abs(b));
  return candidates.length > 0 ? Math.round(candidates[0]) : 0;
}

/** The HUD a centred prompt steps aside from: the phase chips of the 4-way grid hub (not the hub's band, which is as wide as the pair). */
const DODGE_HUD = "[data-grid-hub] [data-state]";

/**
 * The vertical shift (px) that keeps the prompt panel of a table in the middle of the screen off the phase hub (see dodgeShift). It is read
 * from the DOM at rest and again when the prompt, the board or the panel changes size, and handed to the prompt CSS as `--pr-dy`.
 * `key` changes with anything that moves the hub or the panel on screen (the prompt, the box, the layout, the view).
 */
export function usePromptDodge(rootRef: RefObject<HTMLElement | null>, slotRef: RefObject<HTMLElement | null>, active: boolean, key: string): number {
  const [shift, setShift] = useState(0);
  const applied = useRef(0);
  useEffect(() => {
    const root = rootRef.current;
    const slot = slotRef.current;
    if (!active || !root || !slot) {
      applied.current = 0;
      setShift(0);
      return;
    }
    const measure = () => {
      const panel = slot.querySelector<HTMLElement>("[data-prompt-panel]");
      // The pick bar and the chain-response room place themselves; only the panel that is centred moves.
      if (!panel || panel.hasAttribute("data-place") || root.hasAttribute("data-strip-room")) {
        applied.current = 0;
        setShift(0);
        return;
      }
      const board = root.getBoundingClientRect();
      const at = panel.getBoundingClientRect();
      const rect = { x: at.left - board.left, y: at.top - board.top - applied.current, width: at.width, height: at.height };
      const blocks = Array.from(root.querySelectorAll<HTMLElement>(DODGE_HUD))
        .map((node) => node.getBoundingClientRect())
        .filter((r) => r.width > 1 && r.height > 1)
        .map((r) => ({ x: r.left - board.left, y: r.top - board.top, width: r.width, height: r.height }));
      const next = dodgeShift(rect, blocks, { width: board.width, height: board.height });
      if (next === applied.current) return;
      applied.current = next;
      setShift(next);
    };
    let frame = window.requestAnimationFrame(measure);
    const late = window.setTimeout(measure, 450);
    const again = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    const sizes = typeof ResizeObserver !== "undefined" ? new ResizeObserver(again) : null;
    const follow = () => {
      slot.querySelectorAll("[data-prompt-panel]").forEach((node) => sizes?.observe(node));
      root.querySelectorAll(DODGE_HUD).forEach((node) => sizes?.observe(node));
    };
    follow();
    const nodes = typeof MutationObserver !== "undefined" ? new MutationObserver(() => { follow(); again(); }) : null;
    nodes?.observe(slot, { subtree: true, childList: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(late);
      sizes?.disconnect();
      nodes?.disconnect();
    };
  }, [rootRef, slotRef, active, key]);
  return active ? shift : 0;
}
