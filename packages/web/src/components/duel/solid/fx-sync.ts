"use client";

import { useEffect, type RefObject } from "react";
import type { BoardTilt, BoardView } from "../board-view";
import { setFx3dLook } from "../fx3d/shared";

/** The table tilt in degrees as the CSS sets it (`--tilt` on the plane: 15deg, 8deg on narrow screens, 0deg flat). */
export function readPlaneTilt(plane: Element | null): number {
  if (!plane || typeof getComputedStyle === "undefined") return 0;
  const value = parseFloat(getComputedStyle(plane).getPropertyValue("--tilt"));
  return Number.isFinite(value) ? value : 0;
}

/**
 * Keeps the 3D mode FX canvas on the table: ground rings and circles lie in the plane the CSS tilts, and the gold and
 * purple lights use the Solid Vision colours. Reads `--tilt` (so the narrow value and the Flat view follow the CSS),
 * applies on mount, on a view change and on resize, and resets to the classic look (0deg, "v1") on unmount.
 */
export function useSolidFx3dSync(planeRef: RefObject<Element | null>, view: BoardTilt | Pick<BoardView, "tilt">): void {
  const tilt = typeof view === "string" ? view : view.tilt;
  useEffect(() => {
    const apply = () => setFx3dLook({ tilt: readPlaneTilt(planeRef.current), palette: "solid" });
    apply();
    // The view attribute reaches the DOM after this effect on the same commit: read once more next frame.
    const frame = window.requestAnimationFrame(apply);
    window.addEventListener("resize", apply);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", apply);
    };
  }, [planeRef, tilt]);
  useEffect(() => () => setFx3dLook({ tilt: 0, palette: "v1" }), []);
}
