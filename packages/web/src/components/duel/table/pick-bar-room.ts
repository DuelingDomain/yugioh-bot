import { PICK_BAR } from "./grid-stage";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Widths tried after the full one: the bar stacks its text and buttons below PICK_BAR.row. */
const NARROW = [380, 340, 300, 260, 220];
/** The search steps over the box in this many px; the room is the first nearest the middle. */
const STEP = 8;
/** A raised hand card grows about this much of the hand's height above the hand, and this much of it to each side. */
const HAND_RISE = 1.15;
const HAND_SIDE = 0.4;
/** Keep off a card on the board by this much (px): the bar never sits on its border or its glow. */
const CARD_AIR = 4;

export interface PickBarInput {
  /** The board box (px): the room is always inside it. */
  box: { width: number; height: number };
  /** The legal targets (every zone and card the player can pick): the bar never covers one. */
  targets: readonly Rect[];
  /** Your live hand (the union of its cards, measured from the DOM): the bar never covers it nor a card raised from it. */
  hand?: Rect | null;
  /** The HUD that stays on screen (plates, chip, corners, the pinned peek). */
  hud?: readonly Rect[];
  /** Every card on the board, targets or not: the bar keeps off them while a clear place exists. */
  cards?: readonly Rect[];
}

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

const grow = (r: Rect, pad: number): Rect => ({ x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad });

/** The hand with the room a raised card takes: a band above it and a margin at its sides. The bar keeps off all of it. */
export function handReach(hand: Rect): Rect {
  const rise = hand.height * HAND_RISE;
  const side = hand.height * HAND_SIDE;
  return { x: hand.x - side, y: hand.y - rise, width: hand.width + 2 * side, height: hand.height + rise };
}

/** The size of the bar for a width: a row, or stacked below PICK_BAR.row. */
const heightOf = (width: number) => (width < PICK_BAR.row ? PICK_BAR.stackHeight : PICK_BAR.rowHeight);

/** Moves `room` inside the box, `edge` from each side (a room larger than the box starts at the edge). */
export function clampRoom(room: Rect, box: { width: number; height: number }, edge: number = PICK_BAR.edge): Rect {
  const x = Math.max(edge, Math.min(room.x, box.width - room.width - edge));
  const y = Math.max(edge, Math.min(room.y, box.height - room.height - edge));
  return { ...room, x: Math.round(x), y: Math.round(y) };
}

const text = (r: Rect) => [r.x, r.y, r.width, r.height].map(Math.round).join(",");

/**
 * The room of the card-pick bar ("x,y,width,height" for `data-bar-room`): the clear place nearest the middle of the
 * box, never at the edge for its own sake. It is always inside the box, and it never covers a legal target or your hand
 * (nor a card raised from it). The tiers, each tried at the full width and then narrower:
 *   1. off the targets, the hand, the HUD and every card on the board (empty zones may be covered);
 *   2. off the targets, the hand and the HUD;
 *   3. off the targets and the hand.
 * When even the last has no place, the one that covers the least of them (targets and hand first) wins, so the bar is
 * still in view. Pure: the camera is never read or moved.
 */
export function planPickBarRoom(input: PickBarInput): string | undefined {
  const { box } = input;
  if (!(box.width > 0) || !(box.height > 0)) return undefined;
  const edge = PICK_BAR.edge;
  const full = Math.min(PICK_BAR.max, box.width - 2 * edge);
  const widths = [full, ...NARROW.filter((w) => w < full)].filter((w) => w >= 200 || w === full);
  const targets = input.targets.map((r) => grow(r, PICK_BAR.clear));
  const hand = input.hand ? [handReach(input.hand)] : [];
  const hud = [...(input.hud ?? [])];
  const cards = (input.cards ?? []).map((r) => grow(r, CARD_AIR));
  const tiers: Rect[][] = [[...targets, ...hand, ...hud, ...cards], [...targets, ...hand, ...hud], [...targets, ...hand]];
  const cx = box.width / 2;
  const cy = box.height / 2;
  const candidates = (width: number) => {
    const height = Math.min(heightOf(width), box.height - 2 * edge);
    const x0 = edge;
    const y0 = edge;
    const x1 = Math.max(x0, box.width - width - edge);
    const y1 = Math.max(y0, box.height - height - edge);
    const out: Rect[] = [];
    for (let y = y0; y <= y1 + 0.001; y += STEP) {
      for (let x = x0; x <= x1 + 0.001; x += STEP) out.push({ x, y, width, height });
    }
    // The steps can miss the far edge by a few px: the last column and row are always tried.
    for (let x = x0; x <= x1 + 0.001; x += STEP) out.push({ x, y: y1, width, height });
    for (let y = y0; y <= y1 + 0.001; y += STEP) out.push({ x: x1, y, width, height });
    out.push({ x: x1, y: y1, width, height });
    return out;
  };
  const away = (r: Rect) => (r.x + r.width / 2 - cx) ** 2 + (r.y + r.height / 2 - cy) ** 2;
  const all = widths.map((width) => candidates(width));
  for (const blocks of tiers) {
    for (const list of all) {
      let best: Rect | null = null;
      for (const room of list) {
        if (best && away(room) >= away(best)) continue;
        if (blocks.every((block) => overlap(room, block) === 0)) best = room;
      }
      if (best) return text(best);
    }
  }
  // Nothing is clear: the place that covers the least. A target or the hand weighs most, then the HUD, then a card.
  let best: Rect | null = null;
  let bestScore = Infinity;
  for (const room of all[0]) {
    const score =
      1000 * [...targets, ...hand].reduce((sum, r) => sum + overlap(room, r), 0) +
      10 * hud.reduce((sum, r) => sum + overlap(room, r), 0) +
      cards.reduce((sum, r) => sum + overlap(room, r), 0);
    if (score < bestScore || (score === bestScore && best && away(room) < away(best))) {
      best = room;
      bestScore = score;
    }
  }
  return best ? text(best) : undefined;
}
