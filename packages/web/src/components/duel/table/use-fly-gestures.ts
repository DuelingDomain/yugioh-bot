"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { CameraAction } from "./types";

const DRAG_PX = 5;
/** What a drag must not start on: controls, panels and cards. */
const NO_DRAG =
  "button, a, input, [data-holo], [data-hand-seat], [data-pile], [data-uid], [data-legal='true'], [data-slot='prompt'], [data-slot='overlay'], [data-camera-panel], [data-opponent-bar], [role='dialog']";
const NO_WHEEL = "[data-slot='prompt'], [data-slot='overlay'], [data-camera-panel], [role='dialog']";

/**
 * Orbit by dragging and zoom with the wheel in the fly-in view. A drag moves the camera after 5 px, and the click
 * that ends it is dropped, so it does not also fly into a seat. The reducer ignores both while the FX lock is on.
 */
export function useFlyGestures(root: RefObject<HTMLElement | null>, active: boolean, dispatch: (action: CameraAction) => void): void {
  const send = useRef(dispatch);
  send.current = dispatch;
  useEffect(() => {
    const node = root.current;
    if (!active || !node) return;
    let start: { x: number; y: number; id: number } | null = null;
    let last = { x: 0, y: 0 };
    let dragging = false;
    let dropClick = false;

    const down = (event: PointerEvent) => {
      if (event.button !== 0 || (event.target as Element | null)?.closest?.(NO_DRAG)) return;
      start = { x: event.clientX, y: event.clientY, id: event.pointerId };
      last = { x: event.clientX, y: event.clientY };
      dropClick = false;
    };
    const move = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.id) return;
      if (!dragging) {
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_PX) return;
        dragging = true;
        node.dataset.dragging = "true";
        try {
          node.setPointerCapture(event.pointerId);
        } catch {
          // Pointer capture is optional.
        }
      }
      send.current({ type: "orbit", dYawDeg: (event.clientX - last.x) * 0.3, dTiltDeg: -(event.clientY - last.y) * 0.25 });
      last = { x: event.clientX, y: event.clientY };
    };
    const up = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.id) return;
      if (dragging) {
        dropClick = true;
        try {
          node.releasePointerCapture(event.pointerId);
        } catch {
          // Already released.
        }
      }
      dragging = false;
      start = null;
      delete node.dataset.dragging;
    };
    const click = (event: MouseEvent) => {
      if (!dropClick) return;
      dropClick = false;
      event.stopPropagation();
      event.preventDefault();
    };
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element | null)?.closest?.(NO_WHEEL)) return;
      event.preventDefault();
      send.current({ type: "zoom", factor: Math.exp(-event.deltaY * 0.0012) });
    };

    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
    node.addEventListener("click", click, true);
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
      node.removeEventListener("click", click, true);
      node.removeEventListener("wheel", wheel);
      delete node.dataset.dragging;
    };
  }, [active, root]);
}
