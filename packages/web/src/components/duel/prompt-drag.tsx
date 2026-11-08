"use client";

import { useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { clampBarShift, type ClampRect } from "./bar-clamp";
import styles from "./prompt-drag.module.css";

/**
 * A grab handle for a centred prompt. The handle sits inside the prompt surface (the select bar, the yes/no bar, a response or card
 * panel, the Materials window); a drag moves that surface by a CSS offset (`--drag-x`, `--drag-y`, read by the `translate` of each
 * surface), so the surface keeps its planned place and its buttons stay where they are in it. Only the handle takes the touch
 * (`touch-action: none`): the rest of the prompt still scrolls and clicks as before.
 */

/** The same query the compact prompt styles use: a phone, or a window too short for the desktop sizes. */
export const PROMPT_COMPACT_QUERY = "(max-width: 600px), (max-height: 500px)";

/** Air kept between a dragged surface and the edge of the area it moves in. */
export const DRAG_EDGE = 6;

export interface DragOffset {
  x: number;
  y: number;
}

/**
 * The offset to use for a drag that asks for `target`, kept inside `area`. `rect` is the surface as drawn at `offset`; a surface
 * larger than the area lines up with its near edge, so its handle and buttons are the part in view.
 */
export function clampDragOffset(rect: ClampRect, offset: DragOffset, target: DragOffset, area: ClampRect, edge: number = DRAG_EDGE): DragOffset {
  const moved: ClampRect = {
    left: rect.left + target.x - offset.x,
    right: rect.right + target.x - offset.x,
    top: rect.top + target.y - offset.y,
    bottom: rect.bottom + target.y - offset.y,
  };
  const fix = clampBarShift(moved, { dx: 0, dy: 0 }, area, edge);
  return { x: target.x + fix.dx, y: target.y + fix.dy };
}

/** The place a player dragged a prompt to, kept while the same prompt goes on (each pick of a one-by-one choice is a new engine prompt). */
let memory: { key: string; offset: DragOffset } | null = null;

const SURFACE = "[data-prompt-surface], [data-prompt-panel], [data-drag-surface]";

function offsetOf(surface: HTMLElement): DragOffset {
  return { x: parseFloat(surface.style.getPropertyValue("--drag-x")) || 0, y: parseFloat(surface.style.getPropertyValue("--drag-y")) || 0 };
}

function setOffset(surface: HTMLElement, offset: DragOffset) {
  surface.style.setProperty("--drag-x", `${offset.x}px`);
  surface.style.setProperty("--drag-y", `${offset.y}px`);
}

/** The box the surface moves in: the element it is positioned against (the prompt layer, or the window of a pile viewer). */
function areaOf(surface: HTMLElement): ClampRect | null {
  const parent = surface.offsetParent;
  if (!parent) return null;
  const { left, right, top, bottom } = parent.getBoundingClientRect();
  return { left, right, top, bottom };
}

function rectOf(surface: HTMLElement): ClampRect {
  const { left, right, top, bottom } = surface.getBoundingClientRect();
  return { left, right, top, bottom };
}

export function DragGrip({ memoryKey, variant = "bar" }: { memoryKey: string; variant?: "bar" | "panel" }) {
  const gripRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; from: DragOffset; rect: ClampRect; area: ClampRect } | null>(null);

  // A new surface starts where the player left the prompt, and a moved surface stays inside its area when the window or the surface changes size.
  useLayoutEffect(() => {
    const grip = gripRef.current;
    const surface = grip?.closest<HTMLElement>(SURFACE) ?? null;
    if (!surface) return undefined;
    if (memory && memory.key === memoryKey) setOffset(surface, memory.offset);
    const refit = () => {
      const current = offsetOf(surface);
      if (current.x === 0 && current.y === 0) return;
      const area = areaOf(surface);
      if (!area || area.right - area.left < 2 || area.bottom - area.top < 2) return;
      const next = clampDragOffset(rectOf(surface), current, current, area);
      if (next.x === current.x && next.y === current.y) return;
      setOffset(surface, next);
      memory = { key: memoryKey, offset: next };
    };
    refit();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(refit);
    observer.observe(surface);
    if (surface.offsetParent) observer.observe(surface.offsetParent);
    return () => observer.disconnect();
  }, [memoryKey]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const grip = event.currentTarget;
    const surface = grip.closest<HTMLElement>(SURFACE);
    const area = surface ? areaOf(surface) : null;
    if (!surface || !area) return;
    event.preventDefault();
    event.stopPropagation();
    grip.setPointerCapture(event.pointerId);
    grip.dataset.dragging = "true";
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, from: offsetOf(surface), rect: rectOf(surface), area };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const surface = event.currentTarget.closest<HTMLElement>(SURFACE);
    if (!state || state.id !== event.pointerId || !surface) return;
    const target = { x: state.from.x + event.clientX - state.x, y: state.from.y + event.clientY - state.y };
    setOffset(surface, clampDragOffset(state.rect, state.from, target, state.area));
  };

  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    const grip = event.currentTarget;
    delete grip.dataset.dragging;
    if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
    const surface = grip.closest<HTMLElement>(SURFACE);
    if (surface) memory = { key: memoryKey, offset: offsetOf(surface) };
  };

  return (
    <div
      ref={gripRef}
      className={styles.grip}
      data-variant={variant}
      data-drag-grip=""
      role="presentation"
      title="Drag to move"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    />
  );
}
