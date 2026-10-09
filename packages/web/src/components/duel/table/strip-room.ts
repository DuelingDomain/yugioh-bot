import { along, coverTable, grow, handReach, hits, overlap, type Rect } from "./rect-util";

/**
 * The chain-response panel ("You can respond", every option a card) needs a wide room of its own: its cards are large (CARD px wide, about
 * twice the 65 px tiles of the pair box) and it also holds the title, the chain line, the priority chips and the Back / Pass row.
 * All sizes are board px.
 */
export const STRIP_ROOM = {
  /** The width of one card tile (about twice the 65 px tile of the pair box), and the smaller tiles a box with no room for it falls back to. */
  card: 130,
  smaller: [112, 96],
  /** The gap between tiles, and the panel's side padding, the strip's own and 10 px of slack (a border or a scrollbar must not drop a column). */
  gap: 12,
  side: 66,
  /** Everything in the panel that is not the strip (title, chain line, chips, footer, paddings). */
  chrome: 232,
  /** One row of tiles: the art (59:86), the two-line name and the row gap. */
  rowExtra: 57,
  /** The strip fades its last 28 px when more rows wait below: a room that shows one row keeps that much more, so the names stay clear. */
  fade: 28,
  /** The narrowest room: the title and the buttons must fit one row. */
  minWidth: 520,
  /** The least width of a room that has to step down in width: the header wraps on more lines (the real chrome is measured). */
  narrowest: 420,
  /** The first tier (clear of every occupied zone too) may step down in width to this many columns before any zone is covered. */
  clearCols: 3,
  /** A room that shows fewer tiles than this at a time (with more choices waiting) steps down to the smaller tiles where they show more. */
  minShown: 3,
  /** At most this many tiles in a row: more wrap and scroll. */
  maxCols: 6,
  /** The rows the wanted room shows before the strip scrolls. */
  maxRows: 2,
  /** The nearest the room sits to a side of the box. */
  edge: 12,
  /** The air kept off the HUD. */
  air: 8,
  /** The part of the hand's height (from its top edge) the room may cover: a bit, never more. A deeper cover is the last thing the room accepts. */
  handCover: 0.28,
  /** What a step down costs (px of distance to the anchor): a narrower room, a lower room. The wanted size wins unless a smaller one is clearly nearer. */
  widthCost: 40,
  heightCost: 24,
  /** The grid of the sum table of the search, and the coarser one of the last-resort scan (px). */
  cell: 16,
  scanStep: 32,
  /** Blocks (px squared) the last-resort ranking counts overlap in. */
  area: 1000,
  /** The same for the chain's cards (about a tenth of one card's zone): a nick at a corner does not count, covering a card does. */
  sourceArea: 300,
  /** A key HUD piece under less than this (px squared) is clipped, not covered: it does not count. */
  sliver: 600,
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
export function stripRoomSize(count: number, box: { width: number; height: number }, colsCap: number = STRIP_ROOM.maxCols, tile: number = STRIP_ROOM.card, chromePx: number = STRIP_ROOM.chrome, minWidth: number = STRIP_ROOM.minWidth): StripRoomSize {
  const { gap, side, maxRows, edge } = STRIP_ROOM;
  const chrome = chromePx;
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
  /** Where the room wants to sit: the middle of your field at home, the middle of your pair, or the box in your own zoom. */
  anchor?: { x: number; y: number };
  /** The key HUD (the life plates, the phase strip, the turn ring, the Reset control): the room keeps off it unless the box leaves no place. */
  hud?: readonly Rect[];
  /** The HUD that holds your own actions (the turn actions and the response switch): a panel over it hides them, and they draw over the panel's own Back and Pass, so it ranks next to your hand. */
  controls?: readonly Rect[];
  /** The rest of the HUD (the corners, the chain banner, the Deck Master plate, the camera chip): it draws over the panel, so the room keeps off it while a place exists. */
  soft?: readonly Rect[];
  /** Your live hand: the room may cover its top STRIP_ROOM.handCover only; a deeper cover is the last thing it accepts. */
  hand?: Rect | null;
  /** The zones that hold a card (the fields): the room keeps off them while a clear place exists. It may cover empty zones. */
  zones?: readonly Rect[];
  /** The zones of the cards in the chain (the one you respond to): the room never covers them while any other place exists. */
  source?: readonly Rect[];
  /** The height of the panel besides its cards, measured (px). Defaults to STRIP_ROOM.chrome, an estimate. */
  chrome?: number;
}

export interface StripRoom extends Rect {
  card: number;
  cols: number;
}

/** The search steps over the box in this many px (the last column and row are always tried). */
const STEP = 20;
const HEIGHT_STEP = 64;
/** What one step down to a smaller tile costs in a search that mixes tiles. */
const TILE_COST = 120;
/** Air kept off an occupied zone and off a chain source card. */
const ZONE_AIR = 4;
const SOURCE_AIR = 8;

/**
 * The part of your hand a room must not cover: its reach (the sides and a card raised from it) below the line `handCover` of the
 * hand's height down from its top edge. The room may sit over the band above that line.
 */
export function handKeepOut(hand: Rect): Rect {
  const reach = handReach(hand);
  const line = hand.y + hand.height * STRIP_ROOM.handCover;
  return { x: reach.x, y: line, width: reach.width, height: Math.max(0, reach.y + reach.height - line) };
}

interface Variant {
  size: StripRoomSize;
  /** Steps down in width from the wanted one (0 is the wanted width). */
  narrower: number;
  height: number;
  /** Distance (px) this size costs against the wanted one, so a smaller room wins only where it is clearly nearer the anchor. */
  cost: number;
}

/**
 * The sizes to try for some tile widths: for each tile, the wanted width then narrower ones (fewer tiles in a row, one more row of scroll),
 * each at the wanted height then lower ones down to one whole row (the strip scrolls). `coarse` keeps only the wanted and the least height.
 */
function variantsOf(count: number, box: { width: number; height: number }, tiles: readonly number[], chrome: number, coarse: boolean, base: number = STRIP_ROOM.card): Variant[] {
  const wantedCard = stripRoomSize(count, box, STRIP_ROOM.maxCols, base, chrome).card;
  const out: Variant[] = [];
  tiles.forEach((tile, tileIndex) => {
    const first = stripRoomSize(count, box, STRIP_ROOM.maxCols, tile, chrome);
    if (tile !== base && first.card >= wantedCard) return;
    let last = -1;
    let step = 0;
    for (let cols = first.cols; cols >= 1; cols -= 1) {
      const size = cols === first.cols ? first : stripRoomSize(count, box, cols, tile, chrome, STRIP_ROOM.narrowest);
      if (last >= 0 && size.width >= last) continue;
      last = size.width;
      const heights: number[] = [];
      for (let h = size.height; h > size.minHeight; h -= HEIGHT_STEP) heights.push(h);
      heights.push(size.minHeight);
      const picked = coarse ? [heights[0], heights[heights.length - 1]].filter((h, i, all) => all.indexOf(h) === i) : heights;
      picked.forEach((height, hi) => out.push({ size, narrower: step, height, cost: tileIndex * TILE_COST + step * STRIP_ROOM.widthCost + (coarse ? hi * 2 : hi) * STRIP_ROOM.heightCost }));
      step += 1;
      if (size.width <= STRIP_ROOM.narrowest) break;
    }
  });
  return out;
}

/**
 * The room of a chain-response panel (a rect for `--sr-*`): the place nearest the anchor that is wholly inside the box and clear of
 * what matters. The panel may cover the field, empty zones first, and the top strip of your hand (STRIP_ROOM.handCover of its height, no
 * more). The tiers, first that has a place wins (a tier ranks every size and place by the distance to the anchor plus a cost per step
 * down in size, so a narrower or lower room wins only where it is clearly nearer):
 *   1. wanted tiles at the wanted width, or narrower down to STRIP_ROOM.clearCols columns, clear of the HUD, the keep-out of your hand (handKeepOut), the chain's cards and every card on the board;
 *   2. wanted tiles, clear of the same but the cards on the board (the fields are covered, never the cards of the chain);
 *   3. smaller tiles (STRIP_ROOM.smaller), clear of the same as 2;
 *   4. nothing is clear of the key HUD: the wanted tiles (large cards matter more than a ring) in the size and place that cover the least, compared in this order: the chain's cards, a deep cover of
 *      your hand, the soft HUD, how many pieces of the key HUD; the cards on the board may be covered.
 * Pure: the camera is never read or moved.
 */
export function planStripRoom(input: StripRoomInput): StripRoom | undefined {
  let best = planFor(input, STRIP_ROOM.card);
  // A room that shows fewer than STRIP_ROOM.minShown tiles at a time while more choices wait scrolls too much: smaller tiles (112, then 96 px) are taken where they show more at a time.
  for (const tile of STRIP_ROOM.smaller) {
    if (!best || input.count <= tilesShown(best, input) || tilesShown(best, input) >= STRIP_ROOM.minShown) break;
    const next = planFor(input, tile);
    // Smaller tiles never buy their count with a worse cover: nothing more of your actions, your hand, the chain's cards or the HUD may be hidden.
    if (next && tilesShown(next, input) > tilesShown(best, input) && coverOf(next, input).every((n, i) => n <= coverOf(best!, input)[i])) best = next;
  }
  return best;
}

/** What a room covers, as counts: your actions, the deep hand, the chain's cards, the key HUD, the soft HUD (a sliver does not count). */
function coverOf(room: StripRoom, input: StripRoomInput): number[] {
  const count = (blocks: readonly Rect[] = []) => blocks.reduce((n, b) => n + (overlap(room, grow(b, STRIP_ROOM.air)) > STRIP_ROOM.sliver ? 1 : 0), 0);
  return [count(input.controls), input.hand && overlap(room, handKeepOut(input.hand)) > STRIP_ROOM.sliver ? 1 : 0, count(input.source), count(input.hud), count(input.soft)];
}

/** How many tiles the room shows at a time: the whole rows its height holds, each of `cols` tiles (the strip scrolls the rest). */
export function tilesShown(room: StripRoom, input: Pick<StripRoomInput, "count" | "chrome">): number {
  const rows = Math.max(1, Math.floor((room.height - (input.chrome ?? STRIP_ROOM.chrome)) / rowHeight(room.card)));
  return Math.min(input.count, room.cols * rows);
}

/** The plan for one wanted tile width (the tiers below start from `tile`; the smaller tiles are the ones under it). */
function planFor(input: StripRoomInput, tile: number): StripRoom | undefined {
  const { box, count } = input;
  if (!(box.width > 0) || !(box.height > 0) || !(count > 0)) return undefined;
  const edge = STRIP_ROOM.edge;
  const chrome = input.chrome ?? STRIP_ROOM.chrome;
  const wanted = stripRoomSize(count, box, STRIP_ROOM.maxCols, tile, chrome);
  if (wanted.width <= 0 || wanted.height <= 0) return undefined;
  const anchor = input.anchor ?? { x: box.width / 2, y: box.height / 2 };
  const controls = (input.controls ?? []).map((r) => grow(r, STRIP_ROOM.air));
  const hud = [...(input.hud ?? []).map((r) => grow(r, STRIP_ROOM.air)), ...controls];
  const soft = (input.soft ?? []).map((r) => grow(r, STRIP_ROOM.air));
  // The keep-out of your hand (its top strip may be covered), and the whole reach (the strip counts a little in the last-resort score).
  const hand = input.hand ? [handKeepOut(input.hand)] : [];
  const zones = (input.zones ?? []).map((r) => grow(r, ZONE_AIR));
  const source = (input.source ?? []).map((r) => grow(r, SOURCE_AIR));
  const done = (r: Rect, of: StripRoomSize): StripRoom => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), card: of.card, cols: of.cols });

  const search = (blocks: readonly Rect[], variants: readonly Variant[]): StripRoom | null => {
    const covered = coverTable(box, blocks, STRIP_ROOM.cell);
    let best: { room: Rect; of: StripRoomSize } | null = null;
    let bestScore = Infinity;
    for (const variant of variants) {
      if (variant.cost >= bestScore) continue;
      const { width } = variant.size;
      const height = variant.height;
      const xs = along(edge, Math.max(edge, box.width - width - edge), width, anchor.x, STEP);
      const ys = along(edge, Math.max(edge, box.height - height - edge), height, anchor.y, STEP);
      for (const y of ys) {
        const dy = y + height / 2 - anchor.y;
        if (Math.abs(dy) + variant.cost >= bestScore) break;
        for (const x of xs) {
          const score = Math.hypot(x + width / 2 - anchor.x, dy) + variant.cost;
          if (score >= bestScore) break;
          if (covered(x, y, width, height)) continue;
          const room = { x, y, width, height };
          if (blocks.some((b) => hits(room, b))) continue;
          best = { room, of: variant.size };
          bestScore = score;
          break;
        }
      }
    }
    return best ? done(best.room, best.of) : null;
  };

  const wantedTile = variantsOf(count, box, [tile], chrome, false, tile);
  const smallerTiles = variantsOf(count, box, STRIP_ROOM.smaller.filter((t) => t < tile), chrome, false, tile);
  const clear =
    search([...hud, ...soft, ...hand, ...source, ...zones], wantedTile.filter((v) => v.narrower === 0 || v.size.cols >= Math.min(STRIP_ROOM.clearCols, wanted.cols))) ??
    search([...hud, ...soft, ...hand, ...source], wantedTile) ??
    search([...hud, ...soft, ...hand, ...source], smallerTiles);
  if (clear) return clear;

  // No place is clear of the key HUD: the one that costs least, compared in this order (the first difference decides): your own actions covered,
  // your hand covered deeper than its top strip, the chain's cards covered (a card on the field costs less than your hand), the soft HUD covered (it draws over the panel), how many pieces of the key HUD; then the nearer place (a card on the board may be covered). Areas count in blocks of STRIP_ROOM.area px so a sliver does not decide.
  const area = (r: Rect, blocks: readonly Rect[]) => Math.round(blocks.reduce((sum, b) => sum + overlap(r, b), 0) / STRIP_ROOM.area);
  const parts: ((r: Rect, near: number) => number)[] = [
    (r) => controls.reduce((n, b) => n + (overlap(r, b) > STRIP_ROOM.sliver ? 1 : 0), 0),
    (r) => area(r, hand),
    (r) => Math.round(source.reduce((sum, b) => sum + overlap(r, b), 0) / STRIP_ROOM.sourceArea),
    (r) => area(r, soft),
    (r) => hud.reduce((n, b) => n + (overlap(r, b) > STRIP_ROOM.sliver ? 1 : 0), 0),
    (_r, near) => near,
  ];
  let best: StripRoom | null = null;
  let bestKey: number[] | null = null;
  for (const variant of variantsOf(count, box, [tile], chrome, true, tile)) {
    const { width } = variant.size;
    const height = variant.height;
    for (const y of along(edge, Math.max(edge, box.height - height - edge), height, anchor.y, STRIP_ROOM.scanStep)) {
      for (const x of along(edge, Math.max(edge, box.width - width - edge), width, anchor.x, STRIP_ROOM.scanStep)) {
        const room = { x, y, width, height };
        const near = Math.round(Math.hypot(x + width / 2 - anchor.x, y + height / 2 - anchor.y) + variant.cost);
        // The parts are worked out one by one: a place that is worse than the best at the first part that differs stops there.
        const key: number[] = [];
        let better = bestKey === null;
        let worse = false;
        for (let k = 0; k < parts.length; k += 1) {
          const value = parts[k](room, near);
          key.push(value);
          if (better || !bestKey) continue;
          if (value > bestKey[k]) {
            worse = true;
            break;
          }
          if (value < bestKey[k]) better = true;
        }
        if (worse || !better) continue;
        best = done(room, variant.size);
        bestKey = key;
      }
    }
  }
  return best ?? undefined;
}
