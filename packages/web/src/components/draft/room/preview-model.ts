/** Pure rules for the large card preview: how big it is, where it sits, and when it appears. */

/** A pointer must rest on a card this long before the preview opens. */
export const PREVIEW_DELAY_MS = 120;
/** Moving from one card to the next within this long of the last preview skips the wait. */
export const PREVIEW_GRACE_MS = 200;
/** Distance kept from the stage edge, and between the card and its preview. */
export const PREVIEW_MARGIN = 12;
export const PREVIEW_GAP = 14;
/** A side that holds at least this much of the full size is used, scaled to fit, before the next side is tried. */
export const PREVIEW_MIN_FIT = 0.75;
const RATIO = 86 / 59;

export type PreviewSide = "above" | "below" | "right" | "left";

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
  side: PreviewSide;
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
 * Put the preview just above the card. When there is no room, try below, then to the right, then the left.
 * A side that holds three quarters of the full size or more is used at the size that fits.
 * If none does, the side with the most room is used, scaled down to fit. Boxes are in stage pixels.
 */
export function placePreview(card: Box, stage: { width: number; height: number }, width: number): PreviewPlace {
  const m = PREVIEW_MARGIN;
  const g = PREVIEW_GAP;
  const w = width;
  const h = Math.round(width * RATIO);
  const cx = card.left + card.width / 2;
  const cy = card.top + card.height / 2;
  const roomAbove = card.top - g - m;
  const roomBelow = stage.height - m - (card.top + card.height + g);
  const roomRight = stage.width - m - (card.left + card.width + g);
  const roomLeft = card.left - g - m;
  const order: Array<{ side: PreviewSide; room: number; need: number }> = [
    { side: "above", room: roomAbove, need: h },
    { side: "below", room: roomBelow, need: h },
    { side: "right", room: roomRight, need: w },
    { side: "left", room: roomLeft, need: w },
  ];
  const pick =
    order.find((o) => o.room / o.need >= PREVIEW_MIN_FIT) ??
    order.reduce((best, o) => (o.room / o.need > best.room / best.need ? o : best));
  // Smaller only when the chosen side cannot hold the full size.
  const scale = clamp(pick.room / pick.need, 0.4, 1);
  const pw = Math.round(w * scale);
  const ph = Math.round(h * scale);
  const across = (centre: number, size: number, span: number) => clamp(centre - size / 2, m, Math.max(m, span - m - size));
  switch (pick.side) {
    case "above":
      return { side: "above", width: pw, height: ph, left: across(cx, pw, stage.width), top: card.top - g - ph };
    case "below":
      return { side: "below", width: pw, height: ph, left: across(cx, pw, stage.width), top: card.top + card.height + g };
    case "right":
      return { side: "right", width: pw, height: ph, left: card.left + card.width + g, top: across(cy, ph, stage.height) };
    default:
      return { side: "left", width: pw, height: ph, left: card.left - g - pw, top: across(cy, ph, stage.height) };
  }
}
