import { handReach } from "./pick-bar-room";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The chain-response panel ("You can respond", every option a card) needs a wide room of its own: its cards are large (CARD px wide, about
 * twice the 65 px tiles of the pair box) and it also holds the title, the chain line, the priority chips and the Back / Pass row.
 * All sizes are board px.
 */
export const STRIP_ROOM = {
  /** The width of one card tile (about twice the 65 px tile of the pair box), and the smaller tiles a box with no room for it falls back to. */
  card: 130,
  smaller: [112, 96],
  /** The gap between tiles, and the panel's side padding plus the strip's own. */
  gap: 12,
  side: 56,
  /** Everything in the panel that is not the strip (title, chain line, chips, footer, paddings). */
  chrome: 232,
  /** One row of tiles: the art (59:86), the two-line name and the row gap. */
  rowExtra: 57,
  /** The strip fades its last 28 px when more rows wait below: a room that shows one row keeps that much more, so the names stay clear. */
  fade: 28,
  /** The narrowest room: the title and the buttons must fit one row. */
  minWidth: 520,
  /** At most this many tiles in a row: more wrap and scroll. */
  maxCols: 6,
  /** The rows the wanted room shows before the strip scrolls. */
  maxRows: 2,
  /** The nearest the room sits to a side of the box. */
  edge: 12,
  /** The air kept off the HUD. */
  air: 8,
} as const;

const rowHeight = (card: number) => Math.round((card * 86) / 59) + STRIP_ROOM.rowExtra;

export interface StripRoomSize {
  card: number;
  cols: number;
  width: number;
  /** The wanted height: the chrome plus `maxRows` rows at most. */
  height: number;
  /** The least height that still shows one whole row (and the fade of the rows below it). */
  minHeight: number;
}

/** The size the panel wants for `count` cards in a box. */
export function stripRoomSize(count: number, box: { width: number; height: number }, colsCap: number = STRIP_ROOM.maxCols, tile: number = STRIP_ROOM.card): StripRoomSize {
  const { gap, side, chrome, maxRows, edge, minWidth } = STRIP_ROOM;
  const maxCols = Math.max(1, Math.min(STRIP_ROOM.maxCols, colsCap));
  const maxWidth = Math.max(0, box.width - 2 * edge);
  // A box too narrow for two tiles shrinks the tile (a window of a phone is not planned here, but the room stays inside the box).
  const card = Math.max(72, Math.min(tile, Math.floor((maxWidth - side - gap) / 2)));
  const fit = Math.max(1, Math.floor((maxWidth - side + gap) / (card + gap)));
  const cols = Math.max(1, Math.min(Math.max(1, count), maxCols, fit));
  const rows = Math.max(1, Math.ceil(count / cols));
  const width = Math.min(maxWidth, Math.max(minWidth, cols * (card + gap) - gap + side));
  const row = rowHeight(card);
  const wanted = chrome + Math.min(rows, maxRows) * row;
  const maxHeight = Math.max(0, box.height - 2 * edge);
  return { card, cols, width, height: Math.min(wanted, maxHeight), minHeight: Math.min(chrome + row + (rows > 1 ? STRIP_ROOM.fade : 0), maxHeight) };
}

export interface StripRoomInput {
  /** The board box (px): the room is always inside it. */
  box: { width: number; height: number };
  /** The number of cards in the response. */
  count: number;
  /** Where the room wants to sit: the middle of your field at home, the middle of the box in your own zoom. */
  anchor?: { x: number; y: number };
  /** The key HUD (the life plates, the phase strip, the turn ring, the Reset control): the room keeps off it unless the box leaves no place. */
  hud?: readonly Rect[];
  /** The rest of the HUD (the corners, the chain stack, the Deck Master plate, the camera chip): the room keeps off it while a place exists. */
  soft?: readonly Rect[];
  /** Your live hand: the room keeps off it (and off a card raised from it) while a place exists. */
  hand?: Rect | null;
}

export interface StripRoom extends Rect {
  card: number;
  cols: number;
}

const STEP = 20;
const HEIGHT_STEP = 64;

const hits = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const grow = (r: Rect, pad: number): Rect => ({ x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad });

/** The places along one axis (the last one always), nearest the target centre first. */
function along(low: number, high: number, size: number, centre: number): number[] {
  const out: number[] = [];
  for (let v = low; v < high; v += STEP) out.push(v);
  out.push(Math.max(low, high));
  return out.sort((a, b) => Math.abs(a + size / 2 - centre) - Math.abs(b + size / 2 - centre));
}

/**
 * The room of a chain-response panel (a rect for `--sr-*`): the place nearest the anchor that is wholly inside the box and clear of
 * the HUD and your hand. It may cover the field. The tiers, first that has a place wins; in each a size is tried at lower heights
 * down to one whole row (the strip scrolls):
 *   1. clear of the HUD and your hand;
 *   2. clear of the HUD (your hand is covered);
 *   3. clear of the key HUD (the life plates, the phase strip and ring, the Reset control; the rest of the HUD is covered);
 *   4. nothing is clear: the size and place that cover the least HUD (the key HUD weighs most, your hand least).
 * In a tier the wanted width is tried first, then narrower rooms (fewer tiles in a row, so the grid scrolls more), then the same with
 * smaller tiles (STRIP_ROOM.smaller): a smaller tile beats a room over the HUD.
 * Pure: the camera is never read or moved.
 */
export function planStripRoom(input: StripRoomInput): StripRoom | undefined {
  const { box, count } = input;
  if (!(box.width > 0) || !(box.height > 0) || !(count > 0)) return undefined;
  const edge = STRIP_ROOM.edge;
  const size = stripRoomSize(count, box);
  if (size.width <= 0 || size.height <= 0) return undefined;
  const anchor = input.anchor ?? { x: box.width / 2, y: box.height / 2 };
  const hud = (input.hud ?? []).map((r) => grow(r, STRIP_ROOM.air));
  const soft = (input.soft ?? []).map((r) => grow(r, STRIP_ROOM.air));
  const hand = input.hand ? [handReach(input.hand)] : [];
  // The wanted tile and width first, then narrower rooms (fewer tiles in a row, one more row of scroll) down to the least width, then
  // the smaller tiles the same way.
  const sizes: StripRoomSize[] = [];
  for (const tile of [STRIP_ROOM.card, ...STRIP_ROOM.smaller]) {
    const first = tile === STRIP_ROOM.card ? size : stripRoomSize(count, box, STRIP_ROOM.maxCols, tile);
    if (tile !== STRIP_ROOM.card && first.card >= size.card) continue;
    let last = -1;
    for (let cols = first.cols; cols >= 1; cols -= 1) {
      const next = cols === first.cols ? first : stripRoomSize(count, box, cols, tile);
      if (last < 0 || next.width < last) sizes.push(next);
      last = next.width;
      if (next.width <= STRIP_ROOM.minWidth) break;
    }
  }
  const done = (r: Rect, of: StripRoomSize): StripRoom => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), card: of.card, cols: of.cols });

  const search = (blocks: readonly Rect[]): StripRoom | null => {
    for (const of of sizes) {
      const { width } = of;
      const xs = along(edge, box.width - width - edge, width, anchor.x);
      const heights: number[] = [];
      for (let h = of.height; h > of.minHeight; h -= HEIGHT_STEP) heights.push(h);
      heights.push(of.minHeight);
      for (const height of heights) {
        const ys = along(edge, box.height - height - edge, height, anchor.y);
        let best: Rect | null = null;
        let bestAway = Infinity;
        for (const y of ys) {
          const dy = y + height / 2 - anchor.y;
          if (Math.abs(dy) >= bestAway) break;
          for (const x of xs) {
            const dx = x + width / 2 - anchor.x;
            const away = Math.hypot(dx, dy);
            if (away >= bestAway) break;
            const room = { x, y, width, height };
            if (blocks.some((b) => hits(room, b))) continue;
            best = room;
            bestAway = away;
          }
        }
        if (best) return done(best, of);
      }
    }
    return null;
  };
  const clear = search([...hud, ...soft, ...hand]) ?? search([...hud, ...soft]) ?? search(hud);
  if (clear) return clear;

  // Nothing is clear: the size and place that cover the least (a narrow or short room covers less than the wanted one; a larger room wins a tie).
  let worst: StripRoom | null = null;
  let worstScore = Infinity;
  for (const of of sizes) {
    for (const height of of.height === of.minHeight ? [of.height] : [of.height, of.minHeight]) {
      const { width } = of;
      for (const y of along(edge, box.height - height - edge, height, anchor.y)) {
        for (const x of along(edge, box.width - width - edge, width, anchor.x)) {
          const room = { x, y, width, height };
          let score = 0;
          // A HUD over the room hides what is under it, so every HUD counts; the key HUD a little more, your hand less.
          for (const b of hud) score += 3 * overlap(room, b);
          for (const b of soft) score += 2 * overlap(room, b);
          for (const b of hand) score += overlap(room, b);
          // A tie goes to the larger room, then to the one nearer the anchor.
          score += (Math.hypot(x + width / 2 - anchor.x, y + height / 2 - anchor.y) - width * height * 0.01) * 0.0001;
          if (score < worstScore) {
            worst = done(room, of);
            worstScore = score;
          }
        }
      }
    }
  }
  return worst ?? undefined;
}
