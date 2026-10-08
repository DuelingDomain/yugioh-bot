import { PICK_BAR } from "./grid-stage";
import { along, coverTable, grow, handReach, hits, overlap, type Rect } from "./rect-util";

export { handReach };

/** Widths tried after the full one: the bar stacks its text and buttons below PICK_BAR.row. */
const NARROW = [380, 340, 300, 260, 220];
/** The search steps over the box in this many px (the last column and row are always tried). */
const STEP = 16;
/** A narrower bar costs this much (px of distance to the middle) per step: it wins only where it is clearly nearer the middle. */
const WIDTH_COST = 40;
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
 * (nor a card raised from it). The tiers:
 *   1. off the targets, the hand, the HUD and every card on the board (empty zones may be covered);
 *   2. off the targets, the hand and the HUD;
 *   3. off the targets and the hand.
 * In a tier every width competes: the full one, then the narrower stacked ones, ranked by the distance of the room's centre
 * to the middle plus WIDTH_COST per narrower step. So a narrow bar wins where it is clearly nearer the middle, and the full
 * one wins when it is about as near. When even the last tier has no place, the one that covers the least (targets and hand
 * first) wins, so the bar is still in view. One pass over the places: a place is tested against the targets and the hand
 * first, and the search stops when no place left can beat the best of tier 1. Pure: the camera is never read or moved.
 */
export function planPickBarRoom(input: PickBarInput): string | undefined {
  const { box } = input;
  if (!(box.width > 0) || !(box.height > 0)) return undefined;
  const edge = PICK_BAR.edge;
  const full = Math.min(PICK_BAR.max, box.width - 2 * edge);
  const widths = [full, ...NARROW.filter((w) => w < full)].filter((w) => w >= 200 || w === full);
  const inBox = (r: Rect) => r.x < box.width && r.y < box.height && r.x + r.width > 0 && r.y + r.height > 0;
  const targets = input.targets.map((r) => grow(r, PICK_BAR.clear)).filter(inBox);
  const hand = (input.hand ? [handReach(input.hand)] : []).filter(inBox);
  const must = [...targets, ...hand];
  const hud = (input.hud ?? []).filter(inBox);
  const cards = (input.cards ?? []).map((r) => grow(r, CARD_AIR)).filter(inBox);
  const cx = box.width / 2;
  const cy = box.height / 2;
  // A sum table of the grid cells that lie wholly inside a target or the hand: a room that touches one covers it, found in O(1). The
  // search starts at the middle and, in a box full of targets, would otherwise test every place against every block.
  const covered = coverTable(box, must, STEP);
  /** The strictest tier a room passes: 0 all of them, 1 not the cards, 2 not the HUD, -1 none (it covers a target or the hand). */
  const tierOf = (room: Rect) => {
    for (const block of must) if (hits(room, block)) return -1;
    for (const block of hud) if (hits(room, block)) return 2;
    for (const block of cards) if (hits(room, block)) return 1;
    return 0;
  };
  const best: (Rect | null)[] = [null, null, null];
  const bestScore = [Infinity, Infinity, Infinity];
  widths.forEach((width, step) => {
    const cost = step * WIDTH_COST;
    const height = Math.min(heightOf(width), box.height - 2 * edge);
    const xs = along(edge, Math.max(edge, box.width - width - edge), width, cx, STEP);
    const ys = along(edge, Math.max(edge, box.height - height - edge), height, cy, STEP);
    for (const y of ys) {
      const dy = y + height / 2 - cy;
      if (Math.abs(dy) + cost >= bestScore[0]) break;
      for (const x of xs) {
        const dx = x + width / 2 - cx;
        const score = Math.sqrt(dx * dx + dy * dy) + cost;
        if (score >= bestScore[0]) break;
        if (covered(x, y, width, height)) continue;
        const room = { x, y, width, height };
        const tier = tierOf(room);
        if (tier < 0) continue;
        // A room that passes a strict tier also serves the looser ones.
        for (let t = tier; t <= 2; t += 1) {
          if (score < bestScore[t]) {
            bestScore[t] = score;
            best[t] = room;
          }
        }
      }
    }
  });
  for (const found of best) if (found) return text(found);
  // Nothing is clear: the place that covers the least. A target or the hand weighs most, then the HUD, then a card.
  const sum = (room: Rect, list: readonly Rect[]) => {
    let total = 0;
    for (const block of list) total += overlap(room, block);
    return total;
  };
  const width = widths[0];
  const height = Math.min(heightOf(width), box.height - 2 * edge);
  let worst: Rect | null = null;
  let worstScore = Infinity;
  let worstAway = Infinity;
  // Much coarser than the search: every place is scored here, with no early exit.
  const xs = along(edge, Math.max(edge, box.width - width - edge), width, cx, 4 * STEP);
  const ys = along(edge, Math.max(edge, box.height - height - edge), height, cy, 4 * STEP);
  for (const y of ys) {
    for (const x of xs) {
      const room = { x, y, width, height };
      const score = 1000 * sum(room, must) + 10 * sum(room, hud) + sum(room, cards);
      const away = Math.hypot(x + width / 2 - cx, y + height / 2 - cy);
      if (score < worstScore || (score === worstScore && away < worstAway)) {
        worst = room;
        worstScore = score;
        worstAway = away;
      }
    }
  }
  return worst ? text(worst) : undefined;
}
