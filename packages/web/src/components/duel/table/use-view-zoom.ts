"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { easeCam, ROOF_ZOOM_MS } from "../tag/roof-camera";
import {
  clampView,
  counterTransform,
  edgeInsets,
  fitView,
  FLAT_FRAME,
  isIdentity,
  isZoomed,
  layerOffset,
  layerTransform,
  FOLLOW_ATTR,
  panBy,
  pinchView,
  PressSplit,
  stepView,
  VIEW_IDENTITY,
  viewsClose,
  wheelFactor,
  zoomAt,
  type FitItem,
  type LayerFrame,
  type Point,
  type Insets,
  type Rect,
  type View,
} from "./view-zoom";
import styles from "./view-zoom.module.css";

/** The HUD over the board: a press or a wheel that starts here is its own, never a pan or a zoom of the board. */
const HUD = "[data-slot], [data-holo], [data-grid-lp], [data-grid-hub], [data-hub-slot], [data-grid-controls], [data-view-reset], [data-camera-panel], [data-table-chrome], [data-opponent-bar], [role='dialog']";
/** Where the wheel keeps its own meaning (lists that scroll, menus). */
const NO_WHEEL = "[data-slot='prompt'], [data-slot='overlay'], [data-camera-panel], [data-table-chrome], [role='dialog'], [role='menu']";
/** Not empty board space: a double-click here does not reset the view. */
const NOT_EMPTY = "[data-uid], [data-zones], [data-hand-seat], [data-pile], button, a, input, select, textarea, [role='button'], [data-legal='true'], [data-holo]";

/**
 * The HUD that stays in place while the board zooms (the prompts, the controls, the shell's corners and header). The
 * pan may take the edge of the board in under it (see `clampView`), so no card has to stay under it. The life plates and
 * the phase hub are not here: they follow the board (see `followCss`).
 */
export const VIEW_OCCLUDERS = [
  "[data-prompt-panel]",
  "[data-prompt-surface]",
  "[data-slot='prompt'] [data-place]",
  "[data-grid-controls]",
  "[data-view-reset]",
  "[data-camera-panel]",
  "[data-testid='hud-corner']",
  "[data-testid='hud-top']",
  "[data-testid='hud-master']",
  "[data-opponent-bar]",
  "[data-table-chrome]",
  "[data-zoom-occluder]",
].join(", ");

/** The rects (px of the root's box) of the fixed HUD that is over the root. */
export function occluderRects(root: HTMLElement, selector: string = VIEW_OCCLUDERS): Rect[] {
  const box = root.getBoundingClientRect();
  const out: Rect[] = [];
  for (const node of Array.from(root.ownerDocument.querySelectorAll<HTMLElement>(selector))) {
    const r = node.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right <= box.left || r.left >= box.right || r.bottom <= box.top || r.top >= box.bottom) continue;
    out.push({ x: r.left - box.left, y: r.top - box.top, width: r.width, height: r.height });
  }
  return out;
}

/** Time constant of the ease (ms): a wheel notch settles in about a quarter of a second. */
const EASE_MS = 70;
/** A double-click this soon after a drag is part of the drag, not a reset. */
const AFTER_DRAG_MS = 400;
/** Wheel events this close together are one gesture: the HUD insets are read at its first event only. */
const WHEEL_GESTURE_MS = 250;

/** The box and the HUD insets one gesture works with. */
type Held = { box: ReturnType<typeof sizeOf>; insets: Insets };

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
  /** The fixed HUD (a CSS selector, see `VIEW_OCCLUDERS`). */
  occluders?: string;
  /**
   * Nodes inside the layer that stay at their 1x place and size under any view (a CSS selector): your hand is HUD, only
   * the field zooms. The view hook writes a counter transform on them (see `counterTransform`). They must sit in a seat
   * that is upright and at scale 1.
   */
  fixed?: string;
}

export interface UseViewZoom {
  /** The view at rest (it is not updated on every frame of a move). */
  view: View;
  zoomed: boolean;
  /** Back to the camera pose, eased (at once with reduced motion). */
  reset: () => void;
  /** The HUD over the board changed (a prompt opened, closed or moved): the view eases into the new clamps. */
  refit: () => void;
  /** A camera move to `view` (clamped) in `ms` (the Rooftop camera's time and ease); at once with reduced motion or `ms` 0. */
  zoomTo: (view: View, ms?: number) => View;
  /**
   * A camera zoom that shows `items` (board-box px at the camera pose) as large as the free box allows and centres them
   * in it. The free box is the board box minus the HUD over it and the `avoid` rects (board-box px, at the pose).
   */
  zoomFit: (items: readonly FitItem[], avoid?: readonly Rect[], ms?: number) => View;
  /** True when the player moved the view by hand (drag, pinch, wheel) since the last zoomTo or zoomFit. */
  byHand: () => boolean;
}

const pointIn = (node: HTMLElement, event: { clientX: number; clientY: number }): Point => {
  const rect = node.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

const lerpView = (a: View, b: View, t: number): View => ({ s: a.s + (b.s - a.s) * t, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

const sizeOf = (node: HTMLElement) => ({ width: node.clientWidth, height: node.clientHeight });

/**
 * Zoom and pan of the board under a flat camera: the wheel (and Ctrl+wheel, a trackpad pinch) zooms about the
 * pointer; a left-button drag pans; on touch, one finger pans a zoomed board and two fingers pinch. A press is a pan
 * only after it moves past the threshold, and the click that ends a pan is dropped, so one press never is both.
 * The layer transform is written to the DOM on every frame; React sees the view only when it comes to rest.
 */
/** The fixed nodes stand at their own place again: no counter transform or origin stays on them, and no origin is kept. */
function releaseFixed(state: { origins: Map<Element, Point> }) {
  for (const node of state.origins.keys()) {
    (node as HTMLElement).style.transform = "";
    (node as HTMLElement).style.transformOrigin = "";
  }
  state.origins.clear();
}

export function useViewZoom({ rootRef, layerRef, enabled, reducedMotion, resetKey, frame = FLAT_FRAME, occluders = VIEW_OCCLUDERS, fixed }: UseViewZoomOptions): UseViewZoom {
  const [rest, setRest] = useState<View>(VIEW_IDENTITY);
  // `held`: the box and the HUD insets a gesture (a drag, a pinch, a wheel run) reads at its start and keeps.
  const live = useRef({
    current: VIEW_IDENTITY as View,
    target: VIEW_IDENTITY as View,
    frame,
    reducedMotion,
    enabled,
    raf: 0,
    last: 0,
    held: null as Held | null,
    /** A timed camera move (zoomTo): it replaces the exponential ease until it ends or a gesture takes over. */
    anim: null as { from: View; to: View; start: number; ms: number } | null,
    /** The player moved the view by hand (a drag, a pinch, a wheel) since the last camera move of the code (zoomTo, zoomFit). */
    byHand: false,
    /** The fixed nodes and where each stands at the identity view (canvas px, see counterTransform). */
    origins: new Map<Element, Point>(),
  });
  live.current.frame = frame;
  live.current.reducedMotion = reducedMotion;
  live.current.enabled = enabled;
  const occluderSelector = useRef(occluders);
  occluderSelector.current = occluders;
  const fixedSelector = useRef(fixed);
  fixedSelector.current = fixed;
  /** The HUD insets of the box now (the HUD moves: a prompt opens, a drawer slides), read at each gesture. */
  const insetsOf = useCallback((root: HTMLElement): Insets => edgeInsets(occluderRects(root, occluderSelector.current), sizeOf(root)), []);

  /**
   * The counter transform of the fixed nodes (your hand). A node that mounted after the last write (a pick, a draw: the
   * hand renders again) has no origin yet and takes one here; a node that left the layer drops its origin.
   */
  const placeFixed = useCallback(() => {
    const layer = layerRef.current;
    const root = rootRef.current;
    const state = live.current;
    if (!layer) return;
    for (const node of Array.from(state.origins.keys())) if (!node.isConnected) state.origins.delete(node);
    if (!fixedSelector.current) {
      releaseFixed(state);
      return;
    }
    for (const node of Array.from(layer.querySelectorAll<HTMLElement>(fixedSelector.current))) {
      let origin = state.origins.get(node);
      if (!origin && root) {
        // One forced layout per node and gesture: its 1x place, read with its own counter transform off.
        node.style.transform = "";
        const rect = node.getBoundingClientRect();
        const box = root.getBoundingClientRect();
        const f = state.frame;
        const u = layerOffset(state.current, f);
        const s = state.current.s;
        origin = { x: ((rect.left - box.left - f.x) / f.k - u.x) / s, y: ((rect.top - box.top - f.y) / f.k - u.y) / s };
        state.origins.set(node, origin);
      }
      if (!origin) continue;
      node.style.transformOrigin = "0 0";
      node.style.transform = counterTransform(state.current, origin, state.frame);
    }
  }, [layerRef, rootRef]);

  /** Writes the view to the DOM; `atRest` writes the follow vars on the root too (see followShift). */
  const write = useCallback((atRest = false) => {
    const layer = layerRef.current;
    const root = rootRef.current;
    const state = live.current;
    if (layer) {
      layer.style.transform = layerTransform(state.current, state.frame);
      layer.style.transformOrigin = isIdentity(state.current) ? "" : "0 0";
      layer.style.willChange = state.raf !== 0 ? "transform" : "";
    }
    placeFixed();
    if (root) {
      if (isZoomed(state.current)) root.dataset.viewZoomed = "true";
      else delete root.dataset.viewZoomed;
      // The HUD that follows the board (see followShift) reads the layer offset and the scale: on every frame from its
      // own style, at rest from the root as well (a follower that mounts later inherits it).
      const u = layerOffset(state.current, state.frame);
      const x = `${u.x.toFixed(2)}px`;
      const y = `${u.y.toFixed(2)}px`;
      const s = state.current.s.toFixed(4);
      const targets: HTMLElement[] = Array.from(root.querySelectorAll<HTMLElement>(`[${FOLLOW_ATTR}]`));
      if (atRest) targets.push(root);
      for (const node of targets) {
        node.style.setProperty("--vz-x", x);
        node.style.setProperty("--vz-y", y);
        node.style.setProperty("--vz-s", s);
      }
    }
  }, [layerRef, rootRef, placeFixed]);

  const settle = useCallback(() => {
    const state = live.current;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.anim = null;
    write(true);
    // At the identity view the nodes stand at their 1x places: the next move measures them again (a resize or a new hand moved them).
    if (isIdentity(state.current)) releaseFixed(state);
    const at = state.current;
    setRest((prev) => (viewsClose(prev, at) ? prev : at));
  }, [write]);

  const tick = useCallback((time: number) => {
    const state = live.current;
    const dt = state.last ? Math.min(64, time - state.last) : 16;
    state.last = time;
    const anim = state.anim;
    if (anim) {
      const t = Math.min(1, (time - anim.start) / anim.ms);
      state.current = t >= 1 ? anim.to : lerpView(anim.from, anim.to, easeCam(t));
    } else {
      state.current = stepView(state.current, state.target, dt, EASE_MS);
    }
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
    // A gesture or a reset takes over from a timed camera move.
    state.anim = null;
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
  /** A move the player makes (a drag, a pinch, a wheel): a later refit of the code leaves the view where the player put it. */
  const goByHand = useCallback((next: View, instant: boolean) => {
    // A move that goes nowhere (a wheel at the limit, a drag at the edge) is not a view the player chose.
    if (!viewsClose(next, live.current.target)) live.current.byHand = true;
    go(next, instant);
  }, [go]);

  const zoomTo = useCallback((view: View, ms: number = ROOF_ZOOM_MS): View => {
    const root = rootRef.current;
    const state = live.current;
    if (!root) return view;
    const next = clampView(view, sizeOf(root), insetsOf(root));
    state.byHand = false;
    if (ms <= 0 || state.reducedMotion) {
      go(next, true);
      settle();
      return next;
    }
    if (viewsClose(state.current, next) && viewsClose(state.target, next)) return next;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.held = null;
    state.target = next;
    state.anim = { from: state.current, to: next, start: 0, ms };
    state.last = 0;
    state.raf = requestAnimationFrame((time) => {
      if (state.anim) state.anim.start = time;
      tick(time);
    });
    write();
    return next;
  }, [go, insetsOf, rootRef, settle, tick, write]);

  const zoomFit = useCallback((items: readonly FitItem[], avoid: readonly Rect[] = [], ms?: number) => {
    const root = rootRef.current;
    if (!root) return VIEW_IDENTITY;
    const box = sizeOf(root);
    const insets = edgeInsets([...occluderRects(root, occluderSelector.current), ...avoid], box);
    const gap = 8;
    const free = { x: insets.left + gap, y: insets.top + gap, width: box.width - insets.left - insets.right - 2 * gap, height: box.height - insets.top - insets.bottom - 2 * gap };
    // The clamped view the camera aims at (the HUD insets can pan it): the rooms of the prompts clear the field at THIS view.
    return zoomTo(fitView(items, free), ms);
  }, [rootRef, zoomTo]);

  const refit = useCallback(() => {
    const root = rootRef.current;
    const state = live.current;
    if (!root || !isZoomed(state.target)) return;
    // A gesture that is on now keeps these new insets: with its old ones its next move would pull the board back.
    const held = { box: sizeOf(root), insets: insetsOf(root) };
    if (state.held) state.held = held;
    const next = clampView(state.target, held.box, held.insets);
    if (!viewsClose(next, state.target)) go(next, false);
  }, [go, insetsOf, rootRef]);

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
    const insets = insetsOf(root);
    state.target = clampView(state.target, box, insets);
    state.current = state.raf ? clampView(state.current, box, insets) : state.target;
    // A resize moves the 1x places of the fixed nodes: they are measured again (a node keeps no old origin).
    for (const node of state.origins.keys()) (node as HTMLElement).style.transform = "";
    state.origins.clear();
    write(state.raf === 0);
  }, [frame.x, frame.y, frame.k, rootRef, write, insetsOf]);

  // A fixed node that mounts while the view is off the identity (your hand renders again after a pick or a draw) takes its
  // counter transform before the next paint: nothing on the board stays under the view's scale by mistake.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !fixed || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      if (!isIdentity(live.current.current)) placeFixed();
    });
    observer.observe(layer, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [fixed, layerRef, placeFixed]);

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
    // The box and the HUD insets are read once at the start of a gesture (a drag, a pinch, a wheel run), not on every
    // move: a read right after a transform write would force a style and layout pass on each frame.
    // A refit while a gesture is on gives it the new insets (see refit).
    state.held = null;
    let wheelAt = -Infinity;
    const readInsets = () => {
      state.held = { box: sizeOf(root), insets: insetsOf(root) };
      return state.held;
    };
    const box = () => (state.held ?? readInsets()).box;
    const insets = () => (state.held ?? readInsets()).insets;
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
          readInsets();
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
          if (a && b) goByHand(pinchView(pinch.start, pinch.a0, pinch.b0, a, b, box(), insets()), true);
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
          readInsets();
          root.classList.add(styles.dragging);
          window.getSelection?.()?.removeAllRanges();
          try {
            root.setPointerCapture(event.pointerId);
          } catch {
            // Pointer capture is optional.
          }
        }
      }
      if (press.pan) goByHand(panBy(state.target, at.x - press.last.x, at.y - press.last.y, box(), insets()), true);
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
      const now = performance.now();
      if (now - wheelAt > WHEEL_GESTURE_MS) readInsets();
      wheelAt = now;
      goByHand(zoomAt(state.target, pointIn(root, event), wheelFactor(event.deltaY, event.deltaMode, event.ctrlKey), box(), insets()), false);
    };

    const dblclick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest || inHud(target) || target.closest(NOT_EMPTY)) return;
      // Your own field zoomed (a camera zoom): the felt of a field is the field, not empty board; Esc, Back and the reset chip leave.
      if (fixedSelector.current && target.closest("[data-seat-slot]")) return;
      // A cell of the 4-way grid is a field too: a double click on it focuses it (grid-stage) and never zooms out.
      if (target.closest("[data-grid-cell]")) return;
      if (performance.now() - dragEnd < AFTER_DRAG_MS) return;
      reset();
    };

    // Safari: a trackpad pinch comes as gesture events; the page must not zoom.
    type GestureEventLike = Event & { scale?: number; clientX?: number; clientY?: number };
    const gestureStart = (event: Event) => {
      event.preventDefault();
      gesture = state.target;
      readInsets();
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const e = event as GestureEventLike;
      if (!gesture || typeof e.scale !== "number") return;
      const rect = root.getBoundingClientRect();
      const at = typeof e.clientX === "number" && typeof e.clientY === "number" ? pointIn(root, { clientX: e.clientX, clientY: e.clientY }) : { x: rect.width / 2, y: rect.height / 2 };
      goByHand(zoomAt(gesture, at, e.scale, box(), insets()), true);
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
  }, [enabled, go, goByHand, layerRef, reset, rootRef, settle]);

  useEffect(() => () => {
    const state = live.current;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }, []);

  const byHand = useCallback(() => live.current.byHand, []);

  return { view: rest, zoomed: isZoomed(rest), reset, refit, zoomTo, zoomFit, byHand };
}
