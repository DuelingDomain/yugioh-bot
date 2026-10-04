import type { Fx3dApi, Fx3dPalette } from "./types";

/**
 * The one WebGL canvas of the duel room is owned by SummonFx (it lives in its overlay). BattleFx and
 * the destroy layer draw on the same canvas, so SummonFx publishes the API and the overlay element
 * here while the canvas can draw, and they read it when they plan an effect. This module never
 * imports `three`.
 */

export type SharedFx3d = { api: Fx3dApi; host: HTMLElement };

let shared: SharedFx3d | null = null;

/** The look the room asked for (3D mode: table tilt and palette). Re-applied whenever the canvas becomes usable. */
let look: { tilt: number; palette: Fx3dPalette } = { tilt: 0, palette: "v1" };

function applyLook(api: Fx3dApi | undefined): void {
  if (!api) return;
  api.setTableTilt?.(look.tilt);
  api.setPalette?.(look.palette);
}

/** SummonFx calls this whenever the canvas becomes usable (with the pair) or unusable (null). */
export function setSharedFx3d(next: SharedFx3d | null): void {
  shared = next;
  applyLook(next?.api);
}

/** The 3D mode room sets the table tilt (degrees) and palette; they reach the canvas now and when it is rebuilt. */
export function setFx3dLook(next: { tilt: number; palette: Fx3dPalette }): void {
  look = next;
  applyLook(shared?.api);
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
