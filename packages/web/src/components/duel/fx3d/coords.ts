import { clamp01 } from "./ease";
import type { FxRect, Rgb } from "./types";

/**
 * Mapping from DOM rectangles to the 3D scene. The scene is an orthographic view of the board:
 * 1 world unit is 1 CSS pixel, x runs right, y runs UP (WebGL), and the origin is the bottom-left
 * corner of the canvas. A DOM rectangle (y runs down from the top-left) therefore lands exactly on
 * the same pixels, whatever the canvas size. Pure: no three.js, no DOM.
 */

export type Viewport = { w: number; h: number };

/** A rectangle in world space: centre and size, y up. */
export type WorldRect = { cx: number; cy: number; w: number; h: number };

/** DOM y (down from the top) to world y (up from the bottom). */
export function toWorldY(y: number, viewportH: number): number {
  return viewportH - y;
}

export function rectToWorld(rect: FxRect, viewport: Viewport): WorldRect {
  return {
    cx: rect.x + rect.w / 2,
    cy: toWorldY(rect.y + rect.h / 2, viewport.h),
    w: rect.w,
    h: rect.h,
  };
}

/**
 * Where the art window sits in a full card image, as fractions of the image (measured from the top
 * left of a standard 421x614 card). The embodiment shows only this window.
 */
export const ART_BOX = { left: 0.119, right: 0.881, top: 0.179, bottom: 0.702 } as const;

/** Texture rectangle [u0, v0, u1, v1] of the art window (v runs up in texture space). */
export function artCropUv(): [number, number, number, number] {
  return [ART_BOX.left, 1 - ART_BOX.bottom, ART_BOX.right, 1 - ART_BOX.top];
}

/** How far the art window's centre sits below the card centre, as a fraction of the card height. */
export const ART_CENTER_DROP = (ART_BOX.top + ART_BOX.bottom) / 2 - 0.5;

/** The art window of a card standing on `card`, in the same pixel space (y down): a centre and a side. */
export function artWindowOnCard(card: FxRect): { cx: number; cy: number; size: number } {
  return {
    cx: card.x + card.w / 2,
    cy: card.y + card.h / 2 + ART_CENTER_DROP * card.h,
    size: card.w * (ART_BOX.right - ART_BOX.left),
  };
}

/**
 * The resting place of the big portrait: a square of `size` px, its centre pulled toward the middle
 * of the board (away from the summoner's edge) and kept fully inside the canvas. y runs down.
 */
export function portraitTarget(
  card: FxRect,
  viewport: Viewport,
  maxSize = 420,
): { cx: number; cy: number; size: number } {
  const margin = 6;
  const size = Math.max(
    48,
    Math.min(Math.max(160, card.h * 2.6), maxSize, viewport.w * 0.42, viewport.h * 0.55, viewport.w - margin * 2, viewport.h - margin * 2),
  );
  const zoneX = card.x + card.w / 2;
  const zoneY = card.y + card.h / 2;
  const cx = zoneX + (viewport.w / 2 - zoneX) * 0.5;
  const cy = zoneY + (viewport.h / 2 - zoneY) * 0.8;
  const half = size / 2 + margin;
  return {
    cx: Math.min(Math.max(cx, half), Math.max(half, viewport.w - half)),
    cy: Math.min(Math.max(cy, half), Math.max(half, viewport.h - half)),
    size,
  };
}

/** Backing-store pixel ratio: the device ratio, capped, and lowered by the adaptive quality (0..1]. */
export function pixelRatioFor(devicePixelRatio: number, cap: number, quality = 1): number {
  const device = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.max(1, Math.min(device, cap) * (quality > 0 ? clamp01(quality) : 1));
}

/** "214 164 96" (the format of auraTintOf and TONE_RGB) to 0..1 channels. */
export function parseRgbTriplet(value: string): Rgb {
  const parts = value.trim().split(/\s+/).map(Number);
  const [r, g, b] = [parts[0], parts[1], parts[2]].map((n) => (Number.isFinite(n) ? clamp01(n / 255) : 1));
  return [r, g, b];
}
