import type { Fx3dApi } from "./types";

/**
 * The one WebGL canvas of the duel room is owned by SummonFx (it lives in its overlay). BattleFx and
 * the destroy layer draw on the same canvas, so SummonFx publishes the API and the overlay element
 * here while the canvas can draw, and they read it when they plan an effect. This module never
 * imports `three`.
 */

export type SharedFx3d = { api: Fx3dApi; host: HTMLElement };

let shared: SharedFx3d | null = null;

/** SummonFx calls this whenever the canvas becomes usable (with the pair) or unusable (null). */
export function setSharedFx3d(next: SharedFx3d | null): void {
  shared = next;
}

/** The canvas API and its host, only while it can draw right now. */
export function getSharedFx3d(): SharedFx3d | null {
  return shared && shared.api.ready ? shared : null;
}

export type ViewBox = { left: number; top: number; width: number; height: number };

/** A viewport rectangle (getBoundingClientRect) as a canvas rectangle: relative to the host's top-left corner. */
export function viewportToHost(box: ViewBox, host: { left: number; top: number }): { x: number; y: number; w: number; h: number } {
  return { x: box.left - host.left, y: box.top - host.top, w: box.width, h: box.height };
}
