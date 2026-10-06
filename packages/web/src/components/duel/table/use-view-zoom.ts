"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  clampView,
  FLAT_FRAME,
  isIdentity,
  isZoomed,
  layerTransform,
  panBy,
  pinchView,
  PressSplit,
  stepView,
  VIEW_IDENTITY,
  viewsClose,
  wheelFactor,
  zoomAt,
  type LayerFrame,
  type Point,
  type View,
} from "./view-zoom";
import styles from "./view-zoom.module.css";

/** The HUD over the board: a press or a wheel that starts here is its own, never a pan or a zoom of the board. */
const HUD = "[data-slot], [data-holo], [data-grid-lp], [data-grid-hub], [data-hub-slot], [data-grid-controls], [data-view-reset], [data-camera-panel], [data-table-chrome], [data-opponent-bar], [role='dialog']";
/** Where the wheel keeps its own meaning (lists that scroll, menus). */
const NO_WHEEL = "[data-slot='prompt'], [data-slot='overlay'], [data-camera-panel], [data-table-chrome], [role='dialog'], [role='menu']";
/** Not empty board space: a double-click here does not reset the view. */
const NOT_EMPTY = "[data-uid], [data-zones], [data-hand-seat], [data-pile], button, a, input, select, textarea, [role='button'], [data-legal='true'], [data-holo]";

/** Time constant of the ease (ms): a wheel notch settles in about a quarter of a second. */
const EASE_MS = 70;
/** A double-click this soon after a drag is part of the drag, not a reset. */
const AFTER_DRAG_MS = 400;

export interface UseViewZoomOptions {
  /** The board box: it takes the wheel, the presses and the touches. */
  rootRef: RefObject<HTMLElement | null>;
  /** The board layer that zooms and pans (the HUD is outside it). */
  layerRef: RefObject<HTMLElement | null>;
  /** Off in the fly-in view (it has its own orbit and zoom) and before the board is measured: the view is the identity. */
  enabled: boolean;
  reducedMotion: boolean;
  /** The layout of the board (camera mode and target, focus, seats out, the final duel). A change resets the view. */
  resetKey: string;
  /** Where the layer sits in its parent (see `LayerFrame`). */
  frame?: LayerFrame;
}

export interface UseViewZoom {
  /** The view at rest (it is not updated on every frame of a move). */
  view: View;
  zoomed: boolean;
  /** Back to the camera pose, eased (at once with reduced motion). */
  reset: () => void;
}

const pointIn = (node: HTMLElement, event: { clientX: number; clientY: number }): Point => {
  const rect = node.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

const sizeOf = (node: HTMLElement) => ({ width: node.clientWidth, height: node.clientHeight });

/**
 * Zoom and pan of the board under a flat camera: the wheel (and Ctrl+wheel, a trackpad pinch) zooms about the
 * pointer; a left-button drag pans; on touch, one finger pans a zoomed board and two fingers pinch. A press is a pan
 * only after it moves past the threshold, and the click that ends a pan is dropped, so one press never is both.
 * The layer transform is written to the DOM on every frame; React sees the view only when it comes to rest.
 */
export function useViewZoom({ rootRef, layerRef, enabled, reducedMotion, resetKey, frame = FLAT_FRAME }: UseViewZoomOptions): UseViewZoom {
  const [rest, setRest] = useState<View>(VIEW_IDENTITY);
  const live = useRef({ current: VIEW_IDENTITY as View, target: VIEW_IDENTITY as View, frame, reducedMotion, enabled, raf: 0, last: 0 });
  live.current.frame = frame;
  live.current.reducedMotion = reducedMotion;
  live.current.enabled = enabled;

  const write = useCallback(() => {
    const layer = layerRef.current;
    const root = rootRef.current;
    const state = live.current;
    if (layer) {
      layer.style.transform = layerTransform(state.current, state.frame);
      layer.style.transformOrigin = isIdentity(state.current) ? "" : "0 0";
      layer.style.willChange = state.raf !== 0 ? "transform" : "";
    }
    if (root) {
      if (isZoomed(state.current)) root.dataset.viewZoomed = "true";
      else delete root.dataset.viewZoomed;
    }
  }, [layerRef, rootRef]);

  const settle = useCallback(() => {
    const state = live.current;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    write();
    const at = state.current;
    setRest((prev) => (viewsClose(prev, at) ? prev : at));
  }, [write]);

  const tick = useCallback((time: number) => {
    const state = live.current;
    const dt = state.last ? Math.min(64, time - state.last) : 16;
    state.last = time;
    state.current = stepView(state.current, state.target, dt, EASE_MS);
    if (state.current === state.target) {
      settle();
      return;
    }
    write();
    state.raf = requestAnimationFrame(tick);
  }, [settle, write]);

  /** Moves the view to `next`: eased, or at once (a drag, a pinch, reduced motion). */
  const go = useCallback((next: View, instant: boolean) => {
    const state = live.current;
    state.target = next;
    if (instant || state.reducedMotion) {
      state.current = next;
      if (state.raf) {
        cancelAnimationFrame(state.raf);
        state.raf = 0;
      }
      write();
      // With reduced motion a wheel step or a reset lands at once and is at rest; a drag or a pinch rests when it ends.
      if (!instant) settle();
      return;
    }
    if (!state.raf) {
      state.last = 0;
      state.raf = requestAnimationFrame(tick);
      write();
    }
  }, [settle, tick, write]);

  const reset = useCallback(() => go(VIEW_IDENTITY, false), [go]);

  // A new layout of the board resets the view; with reduced motion at once.
  const lastKey = useRef(resetKey);
  useLayoutEffect(() => {
    if (lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    if (isIdentity(live.current.target) && isIdentity(live.current.current)) return;
    reset();
  }, [resetKey, reset]);

  // Off (the fly-in view): the identity at once, so the fly camera never sees a zoomed layer.
  useLayoutEffect(() => {
    if (enabled) return;
    go(VIEW_IDENTITY, true);
    settle();
  }, [enabled, go, settle]);

  // A new fit of the board (a resize, a drawer): the view keeps its scale inside the new clamps.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const state = live.current;
    const box = sizeOf(root);
    state.target = clampView(state.target, box);
    state.current = state.raf ? clampView(state.current, box) : state.target;
    write();
  }, [frame.x, frame.y, frame.k, rootRef, write]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;
    const state = live.current;
    const split = new PressSplit();
    let press: { id: number; touch: boolean; last: Point; pan: boolean } | null = null;
    const touches = new Map<number, Point>();
    let pinch: { start: View; a0: Point; b0: Point; ids: [number, number] } | null = null;
    let dropClick = false;
    let dropTimer = 0;
    let dragEnd = 0;
    let gesture: View | null = null;

    root.style.touchAction = "none";

    const inHud = (target: EventTarget | null) => {
      const node = target as Element | null;
      if (!node?.closest) return true;
      if (layerRef.current?.contains(node)) return false;
      return node.closest(HUD) != null;
    };
    const box = () => sizeOf(root);
    const endDrag = () => {
      root.classList.remove(styles.dragging);
      dragEnd = performance.now();
    };
    const drop = () => {
      dropClick = true;
      window.clearTimeout(dropTimer);
      // The click of this press comes in the same task as its pointerup; a later click is a new press.
      dropTimer = window.setTimeout(() => {
        dropClick = false;
      }, 0);
    };

    const down = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        if (inHud(event.target)) return;
        touches.set(event.pointerId, pointIn(root, event));
        if (touches.size === 2) {
          // Two fingers: a pinch. The press of the first finger is neither a click nor a pan.
          split.cancel();
          if (press?.pan) {
            try {
              root.releasePointerCapture(press.id);
            } catch {
              // Already released.
            }
            endDrag();
          }
          press = null;
          const [[ia, a0], [ib, b0]] = [...touches.entries()];
          pinch = { start: state.target, a0, b0, ids: [ia, ib] };
          return;
        }
        if (touches.size > 2) return;
      } else if (event.button !== 0 || inHud(event.target)) {
        return;
      }
      const at = pointIn(root, event);
      split.down(at);
      press = { id: event.pointerId, touch: event.pointerType === "touch", last: at, pan: false };
      dropClick = false;
    };

    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" && touches.has(event.pointerId)) {
        touches.set(event.pointerId, pointIn(root, event));
        if (pinch) {
          const a = touches.get(pinch.ids[0]);
          const b = touches.get(pinch.ids[1]);
          if (a && b) go(pinchView(pinch.start, pinch.a0, pinch.b0, a, b, box()), true);
          return;
        }
      }
      if (!press || event.pointerId !== press.id) return;
      const at = pointIn(root, event);
      const step = split.move(at);
      if (step === "idle") return;
      if (step === "start") {
        // One finger pans only a zoomed board; a mouse or a pen drag always pans (at scale 1 the clamps hold it still).
        press.pan = !press.touch || isZoomed(state.target);
        if (press.pan) {
          root.classList.add(styles.dragging);
          window.getSelection?.()?.removeAllRanges();
          try {
            root.setPointerCapture(event.pointerId);
          } catch {
            // Pointer capture is optional.
          }
        }
      }
      if (press.pan) go(panBy(state.target, at.x - press.last.x, at.y - press.last.y, box()), true);
      press.last = at;
    };

    const up = (event: PointerEvent) => {
      const cancelled = event.type === "pointercancel";
      if (touches.delete(event.pointerId) && pinch) {
        // The pinch ends with its first finger up; the other finger does nothing until it is lifted too.
        if (pinch.ids.includes(event.pointerId)) {
          pinch = null;
          drop();
          settle();
        }
        return;
      }
      if (!press || event.pointerId !== press.id) return;
      const result = split.up();
      if (press.pan) {
        try {
          root.releasePointerCapture(event.pointerId);
        } catch {
          // Already released.
        }
      }
      if (result === "drag") {
        if (!cancelled) drop();
        endDrag();
        settle();
      }
      press = null;
    };

    // Window, capture phase: the first listener of all, so no handler of the board (React's included) sees the click.
    const click = (event: MouseEvent) => {
      if (!dropClick) return;
      dropClick = false;
      event.stopPropagation();
      event.preventDefault();
    };

    const wheel = (event: WheelEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.(NO_WHEEL)) {
        // A pinch over a prompt must not zoom the page either.
        if (event.ctrlKey) event.preventDefault();
        return;
      }
      event.preventDefault();
      go(zoomAt(state.target, pointIn(root, event), wheelFactor(event.deltaY, event.deltaMode, event.ctrlKey), box()), false);
    };

    const dblclick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest || inHud(target) || target.closest(NOT_EMPTY)) return;
      if (performance.now() - dragEnd < AFTER_DRAG_MS) return;
      reset();
    };

    // Safari: a trackpad pinch comes as gesture events; the page must not zoom.
    type GestureEventLike = Event & { scale?: number; clientX?: number; clientY?: number };
    const gestureStart = (event: Event) => {
      event.preventDefault();
      gesture = state.target;
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const e = event as GestureEventLike;
      if (!gesture || typeof e.scale !== "number") return;
      const rect = root.getBoundingClientRect();
      const at = typeof e.clientX === "number" && typeof e.clientY === "number" ? pointIn(root, { clientX: e.clientX, clientY: e.clientY }) : { x: rect.width / 2, y: rect.height / 2 };
      go(zoomAt(gesture, at, e.scale, box()), true);
    };
    const gestureEnd = (event: Event) => {
      event.preventDefault();
      gesture = null;
      settle();
    };

    root.addEventListener("pointerdown", down);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", up);
    root.addEventListener("wheel", wheel, { passive: false });
    root.addEventListener("dblclick", dblclick);
    root.addEventListener("gesturestart", gestureStart);
    root.addEventListener("gesturechange", gestureChange);
    root.addEventListener("gestureend", gestureEnd);
    window.addEventListener("click", click, true);
    return () => {
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      root.removeEventListener("pointercancel", up);
      root.removeEventListener("wheel", wheel);
      root.removeEventListener("dblclick", dblclick);
      root.removeEventListener("gesturestart", gestureStart);
      root.removeEventListener("gesturechange", gestureChange);
      root.removeEventListener("gestureend", gestureEnd);
      window.removeEventListener("click", click, true);
      window.clearTimeout(dropTimer);
      root.classList.remove(styles.dragging);
      root.style.touchAction = "";
    };
  }, [enabled, go, layerRef, reset, rootRef, settle]);

  useEffect(() => () => {
    const state = live.current;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }, []);

  return { view: rest, zoomed: isZoomed(rest), reset };
}
