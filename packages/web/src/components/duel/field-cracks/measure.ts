import type { Rect } from "./gen";

/* Measures a mat for the crack generator. Everything is in the mat's own layout px (offset* ignores transforms),
   so a rotated, tilted or zoomed field gives the same numbers as a flat one. */

/** Zone slots and piles carry data-kind (field.tsx ZoneSlot / PileZone). */
export const ZONE_SELECTOR = "[data-zones][data-kind]";

export interface Measured {
  w: number;
  h: number;
  zones: Rect[];
  /** Middle of the split element (the shared Extra Monster band of 1v1), when asked for. */
  splitY: number | null;
  /** Screen px per layout px (all ancestor transforms), 1 when unknown. */
  scale: number;
}

function offsetIn(el: HTMLElement, face: HTMLElement): { x: number; y: number } | null {
  let x = 0;
  let y = 0;
  let cur: HTMLElement | null = el;
  for (let guard = 0; cur && cur !== face && guard < 40; guard += 1) {
    x += cur.offsetLeft;
    y += cur.offsetTop;
    const parent = cur.offsetParent as HTMLElement | null;
    if (parent && parent !== face) {
      x += parent.clientLeft;
      y += parent.clientTop;
    }
    cur = parent;
  }
  return cur === face ? { x, y } : null;
}

function rectOf(el: HTMLElement, face: HTMLElement): Rect | null {
  const at = offsetIn(el, face);
  if (!at || el.offsetWidth <= 0 || el.offsetHeight <= 0) return null;
  return [at.x, at.y, at.x + el.offsetWidth, at.y + el.offsetHeight];
}

/** The zone rects inside `face`, plus the face size. Null while the face has no box. */
export function measureFace(face: HTMLElement, zoneSelector: string, avoidSelector: string | null, splitSelector: string | null): Measured | null {
  const w = face.clientWidth;
  const h = face.clientHeight;
  if (!(w > 0) || !(h > 0)) return null;
  const selector = avoidSelector ? `${zoneSelector}, ${avoidSelector}` : zoneSelector;
  const zones: Rect[] = [];
  face.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const rect = rectOf(el, face);
    if (rect) zones.push(rect);
  });
  let splitY: number | null = null;
  if (splitSelector) {
    const split = face.querySelector<HTMLElement>(splitSelector);
    const rect = split ? rectOf(split, face) : null;
    if (rect) splitY = (rect[1] + rect[3]) / 2;
  }
  // The bounding box of a seat turned a quarter is the face's height wide: divide by the turned extent, not by the width.
  const angle = ((Number(face.closest("[data-seat-angle]")?.getAttribute("data-seat-angle") ?? 0) || 0) * Math.PI) / 180;
  const extent = Math.max(1, Math.abs(Math.cos(angle)) * face.offsetWidth + Math.abs(Math.sin(angle)) * face.offsetHeight);
  const box = face.getBoundingClientRect();
  const scale = box.width > 0 ? box.width / extent : 1;
  return { w, h, zones, splitY, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 };
}
