import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Fit-to-viewport maths for the bigger-field layouts. The field is shown at the largest size that fits
 * the room that is left once the slim bars and the edge insets are taken out. Nothing here zooms IN
 * past that fit: an automatic change may shrink the field or bring it back to the fit, never above it.
 * (A person can still zoom in on purpose; that is a camera action, not a layout one.)
 */

export interface FitInput {
  /** The room the field may use, px. Normally the viewport minus the bars (see `availableRoom`). */
  roomWidth: number;
  roomHeight: number;
  /** The natural size of the field content at scale 1, in any one unit (px, or zone units). */
  contentWidth: number;
  contentHeight: number;
  /** A hard floor for the scale. Default 0 (no floor). */
  minScale?: number;
  /** A hard ceiling for the scale. Default none: the owner wants no width caps. */
  maxScale?: number;
}

export interface Room {
  width: number;
  height: number;
}

export interface RoomInput {
  viewportWidth: number;
  viewportHeight: number;
  /** Heights of the slim bars (0 when a bar is not drawn). */
  topBar?: number;
  bottomBar?: number;
  /** Widths reserved beside the field. Keep these 0 for "nothing covers the field": drawers float. */
  leftInset?: number;
  rightInset?: number;
  /** Breathing room on each side of the field. */
  pad?: number;
}

/** The room left for the field after the bars, the side insets and the padding. Never negative. */
export function availableRoom(input: RoomInput): Room {
  const pad = input.pad ?? 0;
  const width = input.viewportWidth - (input.leftInset ?? 0) - (input.rightInset ?? 0) - 2 * pad;
  const height = input.viewportHeight - (input.topBar ?? 0) - (input.bottomBar ?? 0) - 2 * pad;
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

/** The scale at which the content fills the room in its tighter direction. 0 for an empty room or content. */
export function fitFieldScale(input: FitInput): number {
  const { roomWidth, roomHeight, contentWidth, contentHeight } = input;
  if (!(roomWidth > 0) || !(roomHeight > 0) || !(contentWidth > 0) || !(contentHeight > 0)) return 0;
  let scale = Math.min(roomWidth / contentWidth, roomHeight / contentHeight);
  if (input.maxScale !== undefined) scale = Math.min(scale, input.maxScale);
  if (input.minScale !== undefined) scale = Math.max(scale, input.minScale);
  return scale;
}

/** Which direction decides the fit. "height" means more width would not help. */
export function fitLimit(input: Pick<FitInput, "roomWidth" | "roomHeight" | "contentWidth" | "contentHeight">): "width" | "height" {
  return input.roomWidth / input.contentWidth < input.roomHeight / input.contentHeight ? "width" : "height";
}

/**
 * The camera rule as a function: an automatic scale change may not go above the fit. `requested` is
 * what some automatic step wants (a reset, a re-centre, a resize); `fit` is `fitFieldScale`. Returns the
 * value to apply. A person zooming in by hand does not go through this.
 */
export function capAutoZoom(requested: number, fit: number): number {
  if (!Number.isFinite(requested)) return fit;
  return Math.min(requested, fit);
}

/** The content box after scaling and where it sits, centred in the room. */
export function fitFieldBox(input: FitInput): { scale: number; width: number; height: number; left: number; top: number } {
  const scale = fitFieldScale(input);
  const width = input.contentWidth * scale;
  const height = input.contentHeight * scale;
  return { scale, width, height, left: (input.roomWidth - width) / 2, top: (input.roomHeight - height) / 2 };
}

/**
 * The content box of an element, kept current with a ResizeObserver. For formats that fit in JS (the
 * Tag camera, the FFA3 stage) rather than in CSS. Starts at 0x0 on the server and in jsdom, so a
 * caller must treat 0 as "not measured yet" (`fitFieldScale` already returns 0 for that).
 */
export function useElementSize(ref: RefObject<HTMLElement | null>): Room {
  const [size, setSize] = useState<Room>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => {
      const next = { width: node.clientWidth, height: node.clientHeight };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    read();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
