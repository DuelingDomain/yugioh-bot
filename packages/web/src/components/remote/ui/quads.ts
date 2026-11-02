/** Card outlines found on a frozen feed frame. Corners are fractions of the frame (0..1). */
export type Pt = { x: number; y: number };
export type FeedCard = {
  id: string; quad: Pt[]; kind: "face-up" | "face-down"; confidence: number; refined: boolean; covered: boolean;
  cx: number; cy: number; bounds: { left: number; top: number; right: number; bottom: number }; area: number;
};
export type Scale = { w: number; h: number };

const cross = (a: Pt, b: Pt, p: Pt) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
function areaOf(quad: readonly Pt[]) {
  let sum = 0;
  for (let i = 0; i < quad.length; i++) { const a = quad[i]; const b = quad[(i + 1) % quad.length]; sum += a.x * b.y - b.x * a.y; }
  return Math.abs(sum) / 2;
}
/** Wraps a detector result with the numbers the hit tests and the keyboard order need. */
export function toFeedCards(list: { quad: Pt[]; kind: "face-up" | "face-down"; confidence: number; refined: boolean; covered?: boolean }[]): FeedCard[] {
  const cards = list.filter(card => card.quad.length === 4).map((card, index) => {
    const xs = card.quad.map(p => p.x); const ys = card.quad.map(p => p.y);
    return { id: `c${index}`, ...card, covered: !!card.covered, cx: card.quad.reduce((n, p) => n + p.x, 0) / 4, cy: card.quad.reduce((n, p) => n + p.y, 0) / 4,
      bounds: { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }, area: areaOf(card.quad) };
  });
  return readingOrder(cards).map((card, index) => ({ ...card, id: `c${index}` }));
}

/** What a live click may read. A hand, a mouse or a shadow can pass the detector, so a click needs a quad that is shaped and sized like a card. */
export const MIN_CLICK_CONFIDENCE = 0.5;
export const MIN_CARD_AREA = 0.003; // share of the frame
const CARD_RATIO = { min: 1.2, max: 1.8 }; // card is 86:59 = 1.46; perspective and tilt stretch it
/** The outlines a click may land on. A partly visible card (cut by the frame edge) skips the shape test, since its corners are not all real. */
export function readableCards(cards: readonly FeedCard[], frame: Scale): FeedCard[] {
  return cards.filter(card => {
    if (card.confidence < MIN_CLICK_CONFIDENCE || card.area < MIN_CARD_AREA) return false;
    if (!card.refined) return true;
    const side = (a: Pt, b: Pt) => Math.hypot((a.x - b.x) * frame.w, (a.y - b.y) * frame.h);
    const [p0, p1, p2, p3] = card.quad;
    const wide = (side(p0, p1) + side(p3, p2)) / 2; const tall = (side(p1, p2) + side(p0, p3)) / 2;
    const ratio = Math.max(wide, tall) / Math.max(1, Math.min(wide, tall));
    return ratio >= CARD_RATIO.min && ratio <= CARD_RATIO.max;
  });
}

/** Convex test that accepts either winding. `scale` converts fractions to pixels so a distance tolerance is round. */
function distanceToQuad(p: Pt, quad: readonly Pt[], scale: Scale): number {
  const px = (v: Pt) => ({ x: v.x * scale.w, y: v.y * scale.h });
  const point = px(p); const pts = quad.map(px);
  let sign = 0; let inside = true;
  for (let i = 0; i < pts.length; i++) {
    const c = cross(pts[i], pts[(i + 1) % pts.length], point);
    if (c) { if (sign && Math.sign(c) !== sign) inside = false; sign = Math.sign(c); }
  }
  if (inside) return 0;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length]; const dx = b.x - a.x; const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, dx || dy ? ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy) : 0));
    best = Math.min(best, Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)));
  }
  return best;
}
export const pointInQuad = (p: Pt, quad: readonly Pt[], scale: Scale) => distanceToQuad(p, quad, scale) === 0;

/**
 * The card under a point. When outlines overlap, the smaller one wins (the card on top).
 * A point just outside every outline (within `tolerancePx`) picks the nearest one, so a slightly loose click still lands.
 */
export function hitTest(cards: readonly FeedCard[], p: Pt, scale: Scale, tolerancePx = 10): FeedCard | null {
  const inside = cards.filter(card => pointInQuad(p, card.quad, scale)).sort((a, b) => a.area - b.area);
  if (inside.length) return inside[0];
  let best: FeedCard | null = null; let bestDistance = tolerancePx;
  for (const card of cards) { const d = distanceToQuad(p, card.quad, scale); if (d <= bestDistance) { best = card; bestDistance = d; } }
  return best;
}

/** Top row first, left to right. A row is a band half a card tall, so tilted cards in one row keep their order. */
export function readingOrder<T extends { cx: number; cy: number; bounds: { top: number; bottom: number } }>(cards: readonly T[]): T[] {
  if (cards.length < 2) return [...cards];
  const band = (cards.reduce((n, c) => n + (c.bounds.bottom - c.bounds.top), 0) / cards.length) * 0.5;
  const sorted = [...cards].sort((a, b) => a.cy - b.cy); const rows: T[][] = [];
  for (const card of sorted) {
    const row = rows.find(r => Math.abs(r[0].cy - card.cy) <= band);
    if (row) row.push(card); else rows.push([card]);
  }
  return rows.sort((a, b) => a[0].cy - b[0].cy).flatMap(row => row.sort((a, b) => a.cx - b.cx));
}

/** The nearest card in a direction (arrow keys). Falls back to the current one when nothing lies that way. */
export function neighbour(cards: readonly FeedCard[], from: number, direction: "left" | "right" | "up" | "down", scale: Scale): number {
  const origin = cards[from]; if (!origin) return 0;
  let best = from; let bestScore = Infinity;
  cards.forEach((card, index) => {
    if (index === from) return;
    const dx = (card.cx - origin.cx) * scale.w; const dy = (card.cy - origin.cy) * scale.h;
    const along = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    const across = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    if (along <= 4) return;
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = index; }
  });
  return best;
}
