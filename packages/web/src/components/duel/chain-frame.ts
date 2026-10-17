/**
 * Where a chain mark stands on a card, in the board's own pixels.
 *
 * A field of a 3-way or 4-way table is turned by its seat angle, and the card turns with it. The bounding rect of
 * that card is the straight box around it, so a ring or glow drawn from it sits upright and off the card. The frame
 * keeps both: `box` is the straight bounds (what prompts, tags and wires are measured against) and `ring` is the
 * card's own box with the `turn` it needs, so the ring, glow and wash draw on the card, at the angle of its field.
 * A card whose edges run straight across the screen (a 1v1 or Tag field, a half turn) keeps the straight box. A quarter
 * turn is not straight: its edges run along the screen, but the card inside a square zone cell turns with it.
 */
import { zoneFrameOf } from "./event-queue";
import { centerOfQuad, elementQuad, isTurned, quadBox, rectQuad, type Pt, type Quad } from "./quad";

export type FrameBox = { left: number; top: number; width: number; height: number };
export type CardFrame = {
  /** The straight bounds of the card. */
  box: FrameBox;
  /** The card's own box before it is turned about its centre (the same as `box` for a card that is not turned). */
  ring: FrameBox;
  /** Degrees, clockwise: 0 for a card that is not turned. */
  turn: number;
  /** The corner of a turned card that is nearest the top right of the screen; null for a card that is not turned. */
  corner: Pt | null;
};

const rad = (deg: number) => (deg * Math.PI) / 180;
const TIE = 1;

/** The frame of an element's outline `quad` (screen pixels) on a layer whose top-left is `origin`. */
export function frameOfQuad(quad: Quad, origin: { left: number; top: number }, defense: boolean): CardFrame | null {
  const [p0, p1, , p3] = quad;
  const width = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const height = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  if (width < 4 || height < 4) return null;
  const c = centerOfQuad(quad);
  const cx = c.x - origin.left;
  const cy = c.y - origin.top;
  if (!isTurned(quad)) {
    // A straight zone: its bounds are the card. A Defense Position card is turned a quarter inside its portrait zone.
    const bounds = quadBox(quad);
    const flip = defense && bounds.height > bounds.width;
    const w = flip ? bounds.height : bounds.width;
    const h = flip ? bounds.width : bounds.height;
    const box = { left: cx - w / 2, top: cy - h / 2, width: w, height: h };
    return { box, ring: box, turn: 0, corner: null };
  }
  // To a thousandth of a degree: the turn goes into a style string and a change key, which float noise would churn.
  const turn = Math.round(((Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI) * 1000) / 1000;
  const flip = defense && height > width;
  const w = flip ? height : width;
  const h = flip ? width : height;
  const cos = Math.cos(rad(turn));
  const sin = Math.sin(rad(turn));
  const corners = ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as const).map(([x, y]) => ({
    x: cx + x * cos - y * sin,
    y: cy + x * sin + y * cos,
  }));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  // Two corners tie at -45 and 135 degrees. Within a pixel the higher one wins, so the badge does not jump between
  // them while a seat glides through that angle.
  const corner = corners.reduce((best, p) => {
    const gain = p.x - p.y - (best.x - best.y);
    return gain > TIE || (Math.abs(gain) <= TIE && p.y < best.y) ? p : best;
  });
  return {
    box: { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top },
    ring: { left: cx - w / 2, top: cy - h / 2, width: w, height: h },
    turn,
    corner,
  };
}

/**
 * Where a label that hangs from the bottom-left corner of a card, `lift` pixels up the card's own left edge, stands on
 * the screen. The label itself stays upright and grows up and to the right from this point.
 */
export function labelAnchor(frame: CardFrame, lift: number): Pt {
  const { ring, turn } = frame;
  const cos = Math.cos(rad(turn));
  const sin = Math.sin(rad(turn));
  const x = -ring.width / 2;
  const y = ring.height / 2 - lift;
  return {
    x: ring.left + ring.width / 2 + x * cos - y * sin,
    y: ring.top + ring.height / 2 + x * sin + y * cos,
  };
}

/**
 * The frame of a zone element, read from the screen. A zone is a cell wider than its card (a Defense Position card
 * turns inside it), so the ring of a turned field is the card's own frame inside it: that is the box that is drawn
 * turned. A field whose edges run straight keeps the zone's box. Null when the zone has no size to speak of.
 *
 * Only a single zone (`data-zones`) has such a card frame. A hand or pile fallback is a wider element: it keeps its own
 * outline. `mayTurn` false (a 1v1 or Tag board, whose fields never turn) skips the style reads and takes the bounding
 * rect, as before.
 */
export function cardFrame(overlay: DOMRect, zone: HTMLElement, mayTurn = true): CardFrame | null {
  if (overlay.width < 4) return null;
  const defense = zone.dataset.defense === "true";
  if (!mayTurn) return frameOfQuad(rectQuad(zone.getBoundingClientRect()), overlay, defense);
  const quad = elementQuad(zone);
  const own = zone.hasAttribute("data-zones") && isTurned(quad) ? zoneFrameOf(zone) : null;
  return frameOfQuad(own ? elementQuad(own) : quad, overlay, defense);
}

/** A card is this wide for its height (63 x 91 mm). */
const CARD_ASPECT = 0.69;

/**
 * Where a card stood in a hand it has left: one card-sized box on the hand, in the hand's own angle, at the gap the card
 * left (between its neighbours; at an end, one card step past the last card). The mark of a link that activated from the
 * hand and then left it (a discard cost, a send to the Graveyard) is drawn here, never on the whole hand and never on
 * the neighbour that closed the gap. `slot` is the hand position the card had. Null when the hand has no size.
 */
export function handGhostFrame(overlay: DOMRect, hand: HTMLElement, slot: number): CardFrame | null {
  if (overlay.width < 4) return null;
  const cards = [...hand.children]
    .filter((el): el is HTMLElement => el instanceof HTMLElement && el.getBoundingClientRect().width > 4)
    .map((el) => elementQuad(el));
  let quad: Quad;
  if (cards.length === 0) {
    // An empty hand: a card box the height of the hand strip, in the middle of it.
    const strip = elementQuad(hand);
    const across = { x: strip[1].x - strip[0].x, y: strip[1].y - strip[0].y };
    const down = { x: strip[3].x - strip[0].x, y: strip[3].y - strip[0].y };
    const width = Math.hypot(across.x, across.y);
    const height = Math.hypot(down.x, down.y);
    if (width < 4 || height < 4) return null;
    const half = Math.min(width, height * CARD_ASPECT) / 2;
    const ux = across.x / width;
    const uy = across.y / width;
    const vx = down.x / 2;
    const vy = down.y / 2;
    const c = centerOfQuad(strip);
    quad = [
      { x: c.x - ux * half - vx, y: c.y - uy * half - vy },
      { x: c.x + ux * half - vx, y: c.y + uy * half - vy },
      { x: c.x + ux * half + vx, y: c.y + uy * half + vy },
      { x: c.x - ux * half + vx, y: c.y - uy * half + vy },
    ];
  } else {
    const at = Math.max(0, Math.min(cards.length - 1, slot));
    const template = cards[at];
    const centers = cards.map(centerOfQuad);
    const here = centers[at];
    let target: Pt;
    if (slot > 0 && slot < cards.length) {
      target = { x: (centers[slot - 1].x + here.x) / 2, y: (centers[slot - 1].y + here.y) / 2 };
    } else {
      // At an end: one step past the last card (or before the first), by the step between the two cards at that end.
      const near = cards.length > 1 ? centers[slot <= 0 ? 1 : cards.length - 2] : null;
      const step = near ? { x: here.x - near.x, y: here.y - near.y } : { x: 0, y: 0 };
      target = { x: here.x + step.x, y: here.y + step.y };
    }
    const dx = target.x - here.x;
    const dy = target.y - here.y;
    quad = template.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad;
  }
  return frameOfQuad(quad, overlay, false);
}
