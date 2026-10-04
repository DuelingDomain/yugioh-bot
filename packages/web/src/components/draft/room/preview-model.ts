/** Pure rules for the large card preview: how big it is, where it sits, and when it appears. */

/** A pointer must rest on a card this long before the preview opens. */
export const PREVIEW_DELAY_MS = 120;
/** Moving from one card to the next within this long of the last preview skips the wait. */
export const PREVIEW_GRACE_MS = 200;
/** Distance kept from the stage edge. */
export const PREVIEW_MARGIN = 12;
const RATIO = 86 / 59;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PreviewPlace {
  left: number;
  top: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
}

/** How long to wait before showing a preview for a card the pointer just reached. */
export function previewDelay(o: { visible: boolean; hiddenAt: number | null; now: number }): number {
  if (o.visible) return 0;
  if (o.hiddenAt != null && o.now - o.hiddenAt <= PREVIEW_GRACE_MS) return 0;
  return PREVIEW_DELAY_MS;
}

/** About 300px wide on a 1440 x 900 window, growing with the stage and capped to fit it. */
export function previewWidth(stage: { width: number; height: number }): number {
  const wanted = Math.min(460, Math.max(260, Math.round(stage.height * 0.36)));
  const fitsHeight = (stage.height - PREVIEW_MARGIN * 2) / RATIO;
  const fitsWidth = stage.width - PREVIEW_MARGIN * 2;
  return Math.max(120, Math.floor(Math.min(wanted, fitsHeight, fitsWidth)));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The preview grows up out of the hovered card: centred on it, its bottom edge on the card's bottom edge.
 * It is clamped to the stage margins (pushed down if its top would pass the top margin). Boxes are in stage pixels.
 * `originX` and `originY` say where the card sits inside the box, in percent, for the scale-in.
 */
export function placePreview(card: Box, stage: { width: number; height: number }, width: number): PreviewPlace {
  const m = PREVIEW_MARGIN;
  const w = width;
  const h = Math.round(width * RATIO);
  const cx = card.left + card.width / 2;
  const bottom = card.top + card.height;
  const left = clamp(cx - w / 2, m, Math.max(m, stage.width - m - w));
  const top = clamp(bottom - h, m, Math.max(m, stage.height - m - h));
  return {
    left,
    top,
    width: w,
    height: h,
    originX: clamp(((cx - left) / w) * 100, 0, 100),
    originY: clamp(((bottom - top) / h) * 100, 0, 100),
  };
}
