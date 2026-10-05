import { cardImageUrl } from "@/lib/card-image-url";
// The sign-in card wall, as numbers. Everything here is pure, so the layout rules can be tested
// without a browser. The component and the engine call these and never repeat the rules.

/** The three cards in the ring. The wall never shows them, so it never repeats the hero. */
export const RING_CARD_IDS: readonly number[] = [46986418, 23995346, 89631146];

/** The 27 cards on the wall, in the order the owner approved. */
export const WALL_CARD_IDS: readonly number[] = [
  10000000, 10000010, 10000020, 12580477, 15025844, 21844576, 26412047, 28279543, 33396948, 38033121,
  39256679, 40640057, 4206964, 44095762, 44508094, 53129443, 5405694, 55144522, 6368038, 70368879,
  70781052, 70903634, 74677422, 77585513, 81843628, 83764718, 99785935,
];

/** Public login artwork uses the same bounded cache and card-back fallback as app images. */
export function cardImageSrc(id: number): string {
  return cardImageUrl(id, "small");
}

export type WallMode = "walls" | "bands";

/** Card art is 268 by 391. */
export const CARD_RATIO = 268 / 391;
/** Gap between cards, in px. */
export const WALL_GAP = 14;
/** Phone band card height, in px. */
export const BAND_CARD_HEIGHT = 72;
export const BAND_CARD_WIDTH = BAND_CARD_HEIGHT * CARD_RATIO;

/** Card opacity by column, outer first. Dimmed about 15% from the first mock so the ring stays the main thing. */
export const COLUMN_OPACITY: readonly number[] = [0.42, 0.31, 0.22];
export const BAND_OPACITY = 0.42;

/** Milliseconds per card by column, outer first, so a column's speed is one card every few seconds. */
export const COLUMN_STEP_MS: readonly number[] = [6400, 7400, 8000];
/** Phone bands run faster than the walls so they still read as a conveyor. */
export const BAND_STEP_MS = 3600;

/** Breakpoints. Below the first, the walls give way to two bands. The CSS uses the same widths. */
export const WALL_MIN_WIDTH = 900;
export const TWO_COLUMN_MIN_WIDTH = 1200;
export const THREE_COLUMN_MIN_WIDTH = 1760;
/** A phone shorter than this has room for the top band only. */
export const BOTH_BANDS_MIN_HEIGHT = 800;

/** The ring column is 608px wide. The walls take the room on each side of it. */
const RING_WIDTH = 608;

const clamp = (min: number, value: number, max: number) => Math.min(max, Math.max(min, value));

/** Columns per wall at this viewport width. 0 means the phone bands. */
export function columnsForWidth(width: number): 0 | 1 | 2 | 3 {
  if (width >= THREE_COLUMN_MIN_WIDTH) return 3;
  if (width >= TWO_COLUMN_MIN_WIDTH) return 2;
  if (width >= WALL_MIN_WIDTH) return 1;
  return 0;
}

/** Card width in px for a wall. Mirrors the `--cw` rules in login-wall.module.css. */
export function wallCardWidth(cols: 1 | 2 | 3, viewportWidth: number): number {
  const side = (viewportWidth - RING_WIDTH) / 2;
  if (cols === 1) return clamp(84, side - 62, 126);
  if (cols === 2) return clamp(112, (side - 96) / 2, 156);
  return clamp(120, (side - 108) / 3, 168);
}

/** Cards in one half of a rail. A rail holds this set twice, so a drift of half its length repeats with no seam. */
export function railCardCount(length: number, pitch: number): number {
  return Math.max(8, Math.ceil((length + 2 * pitch) / pitch));
}

/** Whether the bottom band is drawn. A short phone or an error message leaves room for the top band only. */
export function showBottomBand(viewportHeight: number, hasMessage: boolean): boolean {
  return viewportHeight >= BOTH_BANDS_MIN_HEIGHT && !hasMessage;
}

export type WallLayout = {
  mode: WallMode;
  /** Columns per wall (walls) or 1 (bands). */
  cols: number;
  /** Cards in one half of each rail. */
  n: number;
  /** Which bands are drawn (bands mode). */
  bottomBand: boolean;
  /** Card width in px (walls) or band card width (bands). */
  cardWidth: number;
};

export function computeLayout(viewport: { width: number; height: number }, wallHeight: number, hasMessage: boolean): WallLayout {
  const cols = columnsForWidth(viewport.width);
  if (cols !== 0) {
    const cardWidth = wallCardWidth(cols, viewport.width);
    const pitch = cardWidth / CARD_RATIO + WALL_GAP;
    return { mode: "walls", cols, n: railCardCount(wallHeight > 0 ? wallHeight : viewport.height, pitch), bottomBand: false, cardWidth };
  }
  const pitch = BAND_CARD_WIDTH + WALL_GAP;
  return {
    mode: "bands",
    cols: 1,
    n: railCardCount(viewport.width, pitch),
    bottomBand: showBottomBand(viewport.height, hasMessage),
    cardWidth: BAND_CARD_WIDTH,
  };
}

/** A key that changes only when the rails would need to be rebuilt. */
export function layoutKey(layout: WallLayout): string {
  return `${layout.mode}:${layout.cols}:${Math.round(layout.cardWidth)}:${layout.n}:${layout.bottomBand ? 2 : 1}`;
}

/** Pitch (card length plus gap) along a rail's axis. */
export function railPitch(layout: WallLayout): number {
  return layout.mode === "walls" ? layout.cardWidth / CARD_RATIO + WALL_GAP : BAND_CARD_WIDTH + WALL_GAP;
}

/** Opacity of a rail's cards. */
export function railOpacity(mode: WallMode, column: number): number {
  return mode === "bands" ? BAND_OPACITY : COLUMN_OPACITY[column] ?? COLUMN_OPACITY[COLUMN_OPACITY.length - 1];
}

/**
 * The card ids of one half of a rail. Walking the 27 ids by 7 (which shares no factor with 27)
 * visits every card before any repeats, and different seeds start each column somewhere else.
 */
export function railDeck(seed: number, n: number): number[] {
  const deck: number[] = [];
  for (let i = 0; i < n; i += 1) deck.push(WALL_CARD_IDS[(seed + i * 7) % WALL_CARD_IDS.length]);
  return deck;
}

/** Where a column starts, as a fraction of one pitch, so neighbouring columns never line up. */
export function railSeed(wallIndex: number, column: number): number {
  return wallIndex * 11 + column * 5 + 2;
}

/** How far a rail starts above (walls) or left of (bands) its natural position, in px. */
export function railOffset(wallIndex: number, column: number, pitch: number): number {
  return ((column * 0.37 + wallIndex * 0.23 + 0.15) % 1) * pitch;
}

/** One loop of a rail in ms: n cards at the column's speed. */
export function railDuration(mode: WallMode, column: number, n: number): number {
  const step = mode === "bands" ? BAND_STEP_MS : COLUMN_STEP_MS[column] ?? COLUMN_STEP_MS[COLUMN_STEP_MS.length - 1];
  return n * step;
}

/** The playbackRate while the drift eases up to full speed. t runs 0 to 1. */
export function rampRate(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 4;
}

/**
 * Milliseconds until the next pick. The first comes at 3.4s (counted from page load, never
 * sooner than 1.5s from now). After that, 4 to 6s on the walls and 6s on a phone.
 * `random` is a number from 0 up to 1.
 */
export function pickDelay(mode: WallMode, first: boolean, sinceLoad: number, random: number): number {
  if (first) return Math.max(1500, 3400 - sinceLoad);
  return mode === "walls" ? 4000 + random * 2000 : 6000;
}

export type PickCandidate = { id: number; centre: number };

/**
 * The card to pick: one whose centre sits near the middle of the viewport, so the pick is
 * seen. Walls look at the middle band of the height (32% to 68%), phones at the middle of the
 * width (36% to 64%). A ring card is never picked.
 */
export function choosePick<T extends PickCandidate>(cards: readonly T[], mode: WallMode, viewport: { width: number; height: number }, random: number): T | null {
  const [lo, hi, extent] = mode === "walls" ? [0.32, 0.68, viewport.height] : [0.36, 0.64, viewport.width];
  const pool = cards.filter((card) => !RING_CARD_IDS.includes(card.id) && card.centre > extent * lo && card.centre < extent * hi);
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random * pool.length))];
}

/** Picks alternate left, right, left on the walls and top, bottom on the bands. */
export function pickTarget(count: number, pickIndex: number): number {
  return count > 0 ? pickIndex % count : -1;
}

/** Pointer parallax: how far the walls lean against the pointer, in px across and up and down. */
export const PARALLAX_X = 10;
export const PARALLAX_Y = 6;
export const PARALLAX_LERP = 0.07;
export const WALL_TILT = 24;

/** The lean for a pointer at (x, y) in a viewport. The walls move against the pointer. */
export function parallaxTarget(x: number, y: number, width: number, height: number): { x: number; y: number } {
  if (width <= 0 || height <= 0) return { x: 0, y: 0 };
  return { x: -(x / width - 0.5) * 2 * PARALLAX_X, y: -(y / height - 0.5) * 2 * PARALLAX_Y };
}

/** Milliseconds the pick takes from lift to settled. */
export const PICK_MS = 2040;
